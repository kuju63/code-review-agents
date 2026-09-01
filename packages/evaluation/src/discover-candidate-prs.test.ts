import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@strands-agents/sdk", () => ({
  Agent: vi.fn(function (this: unknown) {
    return { invoke: invokeMock };
  }),
}));

vi.mock("@strands-agents/sdk/models/openai", () => ({
  OpenAIModel: vi.fn(function (this: unknown) {
    return { kind: "openai" };
  }),
}));

import {
  buildTarget,
  collectReviewTexts,
  GitHubClient,
  hasRecentRelease,
  hasReviewComments,
  type JsonObject,
  loadSkippedTargets,
  loadStackOutputs,
  main,
  makeLlmAssessor,
  parseInteger,
  parseTargetRows,
  type RepoCandidate,
  type ReviewAssessment,
  revalidateExistingTargets,
  type Target,
  validateRepo,
  withinChangeLimits,
  writeStackOutputs,
} from "./discover-candidate-prs.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "discover-candidate-prs-"));
  temporaryDirectories.push(directory);
  return directory;
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function candidate(overrides: Partial<RepoCandidate> = {}): RepoCandidate {
  return {
    repository: "o/r",
    repo_type: "application",
    stack: "react",
    ...overrides,
  };
}

function assessment(overrides: Partial<ReviewAssessment> = {}): ReviewAssessment {
  return {
    severity: "high",
    impact: "security",
    priority: "high",
    rationale: "auth bypass",
    ...overrides,
  };
}

function target(prNumber: number, overrides: Partial<Target> = {}): Target {
  return {
    repository: "o/r",
    pr_number: prNumber,
    stack: "react",
    repo_type: "application",
    severity: "high",
    impact: "security",
    priority: "medium",
    ...overrides,
  };
}

function clientWith(overrides: Partial<GitHubClient>): GitHubClient {
  return {
    getRepo: vi.fn(),
    listReleases: vi.fn(),
    listTagsWithDates: vi.fn(),
    getPr: vi.fn(),
    listMergedPrs: vi.fn(),
    listPrFiles: vi.fn(),
    requirePrFiles: vi.fn(),
    listReviewComments: vi.fn(),
    requireReviewComments: vi.fn(),
    listPrReviews: vi.fn(),
    ...overrides,
  } as unknown as GitHubClient;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("review and change criteria", () => {
  it("qualifies only inline production-file review comments", () => {
    expect(hasReviewComments([{ body: "fix", path: "src/app.ts" }], [])).toBe(true);
    expect(hasReviewComments([], [{ body: "review body" }])).toBe(false);
    expect(hasReviewComments([{ body: "fix", path: "src/app.test.ts" }], [])).toBe(false);
    expect(hasReviewComments([{ body: "   ", path: "src/app.ts" }], [])).toBe(false);
  });

  it("collects nonblank inline and submitted review text", () => {
    expect(
      collectReviewTexts(
        [{ body: " inline " }, { body: " " }],
        [{ body: "review" }, { body: undefined }],
      ),
    ).toEqual(["inline", "review"]);
  });

  it("keeps exact file and line boundaries", () => {
    expect(withinChangeLimits({ changed_files: 20, additions: 500, deletions: 500 })).toBe(true);
    expect(withinChangeLimits({ changed_files: 21, additions: 1, deletions: 0 })).toBe(false);
    expect(withinChangeLimits({ changed_files: 1, additions: 1000, deletions: 1 })).toBe(false);
  });
});

describe("GitHubClient", () => {
  it("sends GitHub headers and returns JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { stargazers_count: 10 }));
    const client = new GitHubClient("tok", { fetch: fetchMock });

    await expect(client.getRepo("o/r")).resolves.toEqual({ stargazers_count: 10 });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("https://api.github.com/repos/o/r");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("returns undefined for authorization and not-found responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401, undefined))
      .mockResolvedValueOnce(response(404, undefined));
    const client = new GitHubClient("tok", { fetch: fetchMock });

    await expect(client.getRepo("o/r")).resolves.toBeUndefined();
    await expect(client.getPr("o/r", 1)).resolves.toBeUndefined();
  });

  it("retries a rate limit with a bounded wait", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limit exceeded", {
          status: 403,
          headers: { "x-ratelimit-reset": "1060" },
        }),
      )
      .mockResolvedValueOnce(response(200, { ok: true }));
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const client = new GitHubClient("tok", {
      fetch: fetchMock,
      sleep: sleepMock,
      now: () => 1_000_000,
      maxRateLimitWaitMilliseconds: 5000,
    });

    await expect(client.getRepo("o/r")).resolves.toEqual({ ok: true });
    expect(sleepMock).toHaveBeenCalledWith(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a finite fallback for a malformed rate-limit reset", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limit exceeded", {
          status: 403,
          headers: { "x-ratelimit-reset": "not-a-number" },
        }),
      )
      .mockResolvedValueOnce(response(200, { ok: true }));
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const client = new GitHubClient("tok", {
      fetch: fetchMock,
      sleep: sleepMock,
      now: () => 1_000_000,
      maxRateLimitWaitMilliseconds: 62_000,
    });

    await expect(client.getRepo("o/r")).resolves.toEqual({ ok: true });
    expect(sleepMock).toHaveBeenCalledWith(62_000);
    expect(Number.isFinite(sleepMock.mock.calls[0]?.[0])).toBe(true);
  });

  it("throws after exhausting rate-limit retries", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response("rate limit exceeded", {
          status: 429,
          headers: { "x-ratelimit-reset": "1060" },
        }),
      ),
    );
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const client = new GitHubClient("tok", {
      fetch: fetchMock,
      sleep: sleepMock,
      now: () => 1_000_000,
      maxRateLimitWaitMilliseconds: 5000,
    });

    await expect(client.getRepo("o/r")).rejects.toThrow("rate limit retries exhausted");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it("throws immediately for a non-rate-limit 403", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const sleepMock = vi.fn();
    const client = new GitHubClient("tok", { fetch: fetchMock, sleep: sleepMock });

    await expect(client.getRepo("o/r")).rejects.toThrow("403 forbidden");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("refuses redirects outside api.github.com without leaking the token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(undefined, { status: 302, headers: { location: "https://example.com/data" } }),
      );
    const client = new GitHubClient("tok", { fetch: fetchMock });

    await expect(client.getRepo("o/r")).rejects.toThrow("Refusing GitHub request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves commit dates for recent tags", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, [{ commit: { sha: "abc" } }, { commit: {} }]))
      .mockResolvedValueOnce(
        response(200, { commit: { committer: { date: "2026-01-01T00:00:00Z" } } }),
      );
    const client = new GitHubClient("tok", {
      fetch: fetchMock,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.listTagsWithDates("o/r")).resolves.toEqual(["2026-01-01T00:00:00Z"]);
  });

  it("paginates merged PRs and stops at the since boundary", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, [
          { number: 1, merged_at: "x", updated_at: "2026-06-02T00:00:00Z" },
          { number: 2, merged_at: undefined, updated_at: "2026-06-02T00:00:00Z" },
        ]),
      )
      .mockResolvedValueOnce(
        response(200, [{ number: 3, merged_at: "x", updated_at: "2025-01-01T00:00:00Z" }]),
      );
    const client = new GitHubClient("tok", {
      fetch: fetchMock,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const pullRequests = await client.listMergedPrs("o/r", "2026-01-01T00:00:00Z", 2);
    expect(pullRequests.map((pullRequest) => pullRequest.number)).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("continues paging after a full page without merged PRs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, [
          { number: 1, updated_at: "2026-06-02T00:00:00Z" },
          { number: 2, updated_at: "2026-06-01T00:00:00Z" },
        ]),
      )
      .mockResolvedValueOnce(
        response(200, [{ number: 3, merged_at: "x", updated_at: "2026-05-31T00:00:00Z" }]),
      );
    const client = new GitHubClient("tok", {
      fetch: fetchMock,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.listMergedPrs("o/r", "2026-01-01", 2)).resolves.toMatchObject([
      { number: 3 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("compares offset and date-only since values as timestamps", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          response(200, [{ number: 1, merged_at: "x", updated_at: "2026-06-01T00:00:00Z" }]),
        ),
      );
    const client = new GitHubClient("tok", { fetch: fetchMock });

    await expect(client.listMergedPrs("o/r", "2026-06-01T01:00:00+01:00", 2)).resolves.toHaveLength(
      1,
    );
    await expect(client.listMergedPrs("o/r", "2026-06-01", 2)).resolves.toHaveLength(1);
  });

  it("fails closed when required revalidation data is unavailable", async () => {
    const client = new GitHubClient("tok", {
      fetch: vi.fn().mockResolvedValue(response(404, undefined)),
    });

    await expect(client.requirePrFiles("o/r", 1)).rejects.toThrow("o/r#1 files");
  });
});

describe("repository validation", () => {
  it("accepts a release exactly on the window boundary", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const client = clientWith({
      listReleases: vi.fn().mockResolvedValue([{ published_at: "2026-01-02T00:00:00Z" }]),
      listTagsWithDates: vi.fn().mockResolvedValue([]),
    });

    await expect(hasRecentRelease(client, "o/r", now, 180)).resolves.toBe(true);
  });

  it("falls back from releases to tag commit dates", async () => {
    const client = clientWith({
      listReleases: vi.fn().mockResolvedValue([]),
      listTagsWithDates: vi.fn().mockResolvedValue(["2026-06-01T00:00:00Z"]),
    });

    await expect(
      hasRecentRelease(client, "o/r", new Date("2026-07-01T00:00:00Z"), 180),
    ).resolves.toBe(true);
  });

  it.each([
    [undefined, "repository not found"],
    [{ archived: true, stargazers_count: 10000 }, "repository archived"],
    [{ archived: false, stargazers_count: 100 }, "stars=100 < 5000"],
  ])("rejects invalid repository metadata: %s", async (repository, reason) => {
    const client = clientWith({
      getRepo: vi.fn().mockResolvedValue(repository),
      listReleases: vi.fn().mockResolvedValue([]),
      listTagsWithDates: vi.fn().mockResolvedValue([]),
    });

    await expect(
      validateRepo(client, candidate(), new Date("2026-07-01T00:00:00Z")),
    ).resolves.toEqual([false, reason]);
  });

  it("requires recent release activity after star validation", async () => {
    const client = clientWith({
      getRepo: vi.fn().mockResolvedValue({ archived: false, stargazers_count: 10000 }),
      listReleases: vi.fn().mockResolvedValue([]),
      listTagsWithDates: vi.fn().mockResolvedValue([]),
    });

    await expect(
      validateRepo(client, candidate(), new Date("2026-07-01T00:00:00Z")),
    ).resolves.toEqual([false, "no release in last 180 days"]);
  });
  it("validates non-negative CLI integers", () => {
    expect(parseInteger("0")).toBe(0);
    expect(parseInteger("42")).toBe(42);
    for (const value of ["", "   ", "-1", "1.5", "nope"]) {
      expect(() => parseInteger(value)).toThrow("non-negative integer");
    }
  });
});

describe("LLM assessment", () => {
  it("constructs direct OpenAIModel configuration and returns structured output", async () => {
    const output = assessment({ impact: "correctness" });
    invokeMock.mockResolvedValue({ structuredOutput: output });

    const assessor = makeLlmAssessor("gpt-4o", "http://localhost:11434/v1");
    await expect(assessor("PR title", ["finding one", "finding two"])).resolves.toEqual(output);

    expect(OpenAIModel).toHaveBeenCalledWith({
      api: "chat",
      modelId: "gpt-4o",
      clientConfig: { baseURL: "http://localhost:11434/v1", timeout: 120000 },
      temperature: 0,
    });
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({ model: { kind: "openai" }, tools: [] }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      expect.stringContaining("- finding one\n\n- finding two"),
      expect.objectContaining({ structuredOutputSchema: expect.anything() }),
    );
  });

  it("omits temperature and base URL when no compatible endpoint is configured", () => {
    makeLlmAssessor("gpt-4o");

    expect(OpenAIModel).toHaveBeenCalledWith({
      api: "chat",
      modelId: "gpt-4o",
      clientConfig: { timeout: 120000 },
    });
  });

  it("fails closed on invocation failure or missing structured output", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({});
    const assessor = makeLlmAssessor("gpt-4o");

    await expect(assessor("one", ["finding"])).resolves.toBeUndefined();
    await expect(assessor("two", ["finding"])).resolves.toBeUndefined();
  });
});

describe("target building and revalidation", () => {
  function validClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
    return clientWith({
      getPr: vi.fn().mockResolvedValue({ changed_files: 3, additions: 10, deletions: 5 }),
      listPrFiles: vi.fn().mockResolvedValue([{ filename: "src/app.ts", patch: "@@ -1 +1 @@" }]),
      listReviewComments: vi.fn().mockResolvedValue([{ body: "fix this", path: "src/app.ts" }]),
      listPrReviews: vi.fn().mockResolvedValue([]),
      ...overrides,
    });
  }

  it("builds the stable target shape for an eligible PR", async () => {
    const result = await buildTarget(
      validClient(),
      candidate(),
      { number: 42, title: "t" },
      vi.fn().mockResolvedValue(assessment()),
    );

    expect(result).toEqual({
      repository: "o/r",
      pr_number: 42,
      stack: "react",
      repo_type: "application",
      severity: "high",
      impact: "security",
      priority: "high",
    });
  });

  it.each([
    ["missing detail", { getPr: vi.fn().mockResolvedValue(undefined) }],
    [
      "oversized change",
      { getPr: vi.fn().mockResolvedValue({ changed_files: 21, additions: 1, deletions: 0 }) },
    ],
    [
      "non-production files",
      { listPrFiles: vi.fn().mockResolvedValue([{ filename: "README.md" }]) },
    ],
    ["no inline comments", { listReviewComments: vi.fn().mockResolvedValue([]) }],
  ])("skips %s", async (_name, override) => {
    await expect(
      buildTarget(
        validClient(override),
        candidate(),
        { number: 1, title: "t" },
        vi.fn().mockResolvedValue(assessment()),
      ),
    ).resolves.toBeUndefined();
  });

  it("skips failed LLM classification", async () => {
    await expect(
      buildTarget(
        validClient(),
        candidate(),
        { number: 1, title: "t" },
        vi.fn().mockResolvedValue(undefined),
      ),
    ).resolves.toBeUndefined();
  });

  it("revalidates criteria while preserving existing object classifications", async () => {
    const targets = [target(1), target(2), target(3)];
    const client = clientWith({
      requirePrFiles: vi
        .fn()
        .mockResolvedValueOnce([{ filename: "src/app.ts", patch: "x" }])
        .mockResolvedValueOnce([{ filename: "backend/app.py", patch: "x" }])
        .mockResolvedValueOnce([{ filename: "src/other.ts", patch: "x" }]),
      requireReviewComments: vi
        .fn()
        .mockResolvedValueOnce([{ body: "fix", path: "src/app.ts" }])
        .mockResolvedValueOnce([]),
    });

    const accepted = await revalidateExistingTargets(client, targets);
    expect(accepted).toEqual([targets[0]]);
    expect(accepted[0]).toBe(targets[0]);
  });

  it("aborts revalidation when GitHub retrieval fails", async () => {
    const client = clientWith({
      requirePrFiles: vi.fn().mockRejectedValue(new Error("GitHub fetch failed for o/r#1 files")),
    });

    await expect(revalidateExistingTargets(client, [target(1)])).rejects.toThrow("o/r#1 files");
  });
});

describe("stack outputs", () => {
  it("routes targets and creates empty stable stack files", async () => {
    const directory = await temporaryDirectory();
    await writeStackOutputs(
      [target(1), target(2, { repository: "o/vue", stack: "vue" })],
      directory,
      ["react", "vue", "angular"],
    );

    expect(
      JSON.parse(await readFile(join(directory, "pr_targets_react.json"), "utf8")),
    ).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(directory, "pr_targets_vue.json"), "utf8"))[0],
    ).toMatchObject({
      repository: "o/vue",
    });
    expect(JSON.parse(await readFile(join(directory, "pr_targets_angular.json"), "utf8"))).toEqual(
      [],
    );
  });

  it("writes stacks outside the defaults", async () => {
    const directory = await temporaryDirectory();
    await writeStackOutputs([target(3, { stack: "solid" })], directory, ["react"]);

    expect(
      JSON.parse(await readFile(join(directory, "pr_targets_solid.json"), "utf8")),
    ).toHaveLength(1);
  });

  it("loads only skipped repositories and de-duplicates PRs", async () => {
    const directory = await temporaryDirectory();
    const kept = target(1, { repository: "o/keep" });
    await writeFile(
      join(directory, "pr_targets_react.json"),
      JSON.stringify([kept, kept, target(2, { repository: "o/refresh" })]),
    );

    await expect(
      loadSkippedTargets(
        directory,
        [candidate({ repository: "o/keep" }), candidate({ repository: "o/refresh" })],
        new Set(["o/keep"]),
      ),
    ).resolves.toEqual([kept]);
  });

  it("logs and skips non-integer PR numbers in skipped repositories", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, "pr_targets_react.json"),
      JSON.stringify([target(1), { ...target(2), pr_number: 1.5 }]),
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(loadSkippedTargets(directory, [candidate()], new Set(["o/r"]))).resolves.toEqual([
      target(1),
    ]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("row 1"));
    stderr.mockRestore();
  });

  it("rejects non-array and invalid target rows with path and index", () => {
    expect(() => parseTargetRows({}, "targets.json")).toThrow(
      "Existing target file is not a JSON array: targets.json",
    );
    expect(() =>
      parseTargetRows([{ repository: "o/r", pr_number: "1", stack: "react" }], "targets.json"),
    ).toThrow("targets.json: invalid target row 0");
    for (const prNumber of [-1, 1.5]) {
      expect(() =>
        parseTargetRows(
          [{ repository: "o/r", pr_number: prNumber, stack: "react" }],
          "targets.json",
        ),
      ).toThrow("targets.json: invalid target row 0");
    }
  });

  it("publishes stack outputs without leaving temporary files", async () => {
    const directory = await temporaryDirectory();
    await writeStackOutputs([target(1)], directory, ["react"]);

    expect(await readdir(directory)).toEqual(["pr_targets_react.json"]);
  });

  it("requires every stack file during atomic revalidation loading", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "pr_targets_react.json"), "[]");

    await expect(loadStackOutputs(directory, ["react", "vue"])).rejects.toThrow(
      "Required target file not found",
    );
  });
});

describe("CLI workflow", () => {
  it("returns one when required environment is missing", async () => {
    await expect(
      main(["node", "discover-candidate-prs"], { env: {}, loadEnvironment: vi.fn() }),
    ).resolves.toBe(1);
  });

  it("requires a generation model only outside revalidation", async () => {
    const directory = await temporaryDirectory();
    const repos = join(directory, "repos.json");
    await writeFile(repos, "[]");

    await expect(
      main(["node", "discover-candidate-prs", "--repos", repos, "--output-dir", directory], {
        env: { GITHUB_TOKEN: "tok" },
        loadEnvironment: vi.fn(),
      }),
    ).resolves.toBe(1);
  });

  it("revalidates all existing stack files without constructing an assessor", async () => {
    const directory = await temporaryDirectory();
    await writeStackOutputs([target(1), target(2, { stack: "solid" })], directory);
    const client = clientWith({
      requirePrFiles: vi.fn().mockResolvedValue([{ filename: "src/app.ts", patch: "@@ -1 +1 @@" }]),
      requireReviewComments: vi.fn().mockResolvedValue([{ body: "fix", path: "src/app.ts" }]),
    });
    const assessorFactory = vi.fn();

    await expect(
      main(["node", "discover-candidate-prs", "--output-dir", directory, "--revalidate-existing"], {
        env: { GITHUB_TOKEN: "tok" },
        loadEnvironment: vi.fn(),
        clientFactory: () => client,
        assessorFactory,
      }),
    ).resolves.toBe(0);
    expect(assessorFactory).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(directory, "pr_targets_react.json"), "utf8"))).toEqual([
      target(1),
    ]);
    expect(JSON.parse(await readFile(join(directory, "pr_targets_solid.json"), "utf8"))).toEqual([
      target(2, { stack: "solid" }),
    ]);
  });

  it("discovers targets end to end and preserves explicitly skipped targets", async () => {
    const directory = await temporaryDirectory();
    const repos = join(directory, "repos.json");
    const preserved = target(7, { repository: "o/skip" });
    await writeFile(join(directory, "pr_targets_react.json"), JSON.stringify([preserved]));
    await writeFile(
      repos,
      JSON.stringify([candidate({ repository: "o/skip" }), candidate({ repository: "o/new" })]),
    );
    const recent = "2026-06-01T00:00:00Z";
    const client = clientWith({
      getRepo: vi.fn().mockResolvedValue({ stargazers_count: 10000, archived: false }),
      listReleases: vi.fn().mockResolvedValue([{ published_at: recent }]),
      listTagsWithDates: vi.fn().mockResolvedValue([]),
      listMergedPrs: vi.fn().mockResolvedValue([{ number: 8, title: "fix" }]),
      getPr: vi.fn().mockResolvedValue({ changed_files: 2, additions: 5, deletions: 5 }),
      listPrFiles: vi.fn().mockResolvedValue([{ filename: "src/app.ts", patch: "@@ -1 +1 @@" }]),
      listReviewComments: vi.fn().mockResolvedValue([{ body: "fix", path: "src/app.ts" }]),
      listPrReviews: vi.fn().mockResolvedValue([{ body: "context" }]),
    });
    const assessor = vi.fn().mockResolvedValue(assessment());
    const assessorFactory = vi.fn().mockReturnValue(assessor);

    await expect(
      main(
        [
          "node",
          "discover-candidate-prs",
          "--repos",
          repos,
          "--output-dir",
          directory,
          "--release-window-days",
          "30",
          "--skip-repos",
          "o/skip",
        ],
        {
          env: {
            GITHUB_TOKEN: "tok",
            SEEDED_GEN_MODEL_ID: "test-model",
            SEEDED_GEN_LLM_BASE_URL: "http://llm.test/v1",
          },
          now: () => new Date("2026-07-01T00:00:00Z"),
          sleep: vi.fn().mockResolvedValue(undefined),
          loadEnvironment: vi.fn(),
          clientFactory: () => client,
          assessorFactory,
        },
      ),
    ).resolves.toBe(0);

    expect(assessorFactory).toHaveBeenCalledWith("test-model", "http://llm.test/v1");
    expect(client.listMergedPrs).toHaveBeenCalledWith("o/new", "2026-01-02T00:00:00Z", 50);
    expect(assessor).toHaveBeenCalledWith("fix", ["fix", "context"]);
    expect(JSON.parse(await readFile(join(directory, "pr_targets_react.json"), "utf8"))).toEqual([
      preserved,
      target(8, { repository: "o/new", priority: "high" }),
    ]);
  });

  it("writes accepted targets after each repository before continuing", async () => {
    const directory = await temporaryDirectory();
    const repos = join(directory, "repos.json");
    await writeFile(repos, JSON.stringify([candidate({ repository: "o/one" })]));
    const client = clientWith({
      getRepo: vi.fn().mockResolvedValue({ stargazers_count: 10000, archived: false }),
      listReleases: vi.fn().mockResolvedValue([{ published_at: "2026-06-01T00:00:00Z" }]),
      listTagsWithDates: vi.fn().mockResolvedValue([]),
      listMergedPrs: vi.fn().mockResolvedValue([{ number: 1, title: "fix" }]),
      getPr: vi.fn().mockResolvedValue({ changed_files: 1, additions: 1, deletions: 0 }),
      listPrFiles: vi.fn().mockResolvedValue([{ filename: "src/a.ts", patch: "x" }]),
      listReviewComments: vi.fn().mockResolvedValue([{ body: "fix", path: "src/a.ts" }]),
      listPrReviews: vi.fn().mockResolvedValue([]),
    });
    const pauses: number[] = [];

    await main(["node", "discover-candidate-prs", "--repos", repos, "--output-dir", directory], {
      env: { GITHUB_TOKEN: "tok", SEEDED_GEN_MODEL_ID: "model" },
      now: () => new Date("2026-07-01T00:00:00Z"),
      loadEnvironment: vi.fn(),
      clientFactory: () => client,
      assessorFactory: () => vi.fn().mockResolvedValue(assessment()),
      sleep: async (milliseconds) => {
        if (milliseconds === 1000) {
          const rows = JSON.parse(
            await readFile(join(directory, "pr_targets_react.json"), "utf8"),
          ) as JsonObject[];
          expect(rows).toHaveLength(1);
        }
        pauses.push(milliseconds);
      },
    });

    expect(pauses).toEqual([400, 1000]);
  });
});
