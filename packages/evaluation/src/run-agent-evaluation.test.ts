import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateConcurrently,
  evaluateItem,
  main,
  pollTask,
  sendTask,
  writePredictionsAndSidecar,
} from "./run-agent-evaluation.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "run-agent-evaluation-"));
  tempDirectories.push(directory);
  return directory;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch mock that never resolves on its own, mirroring a hung connection; it only settles when the captured AbortSignal fires. */
function hangingFetchMock() {
  const fetch = vi.fn().mockImplementation(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
  return fetch;
}

const leadReport = {
  overallSummary: "looks fine",
  decisions: [
    {
      reviewerId: "react-reviewer",
      perspective: "technical",
      finding: {
        filePath: "src/a.tsx",
        line: 10,
        comment: "missing null check",
        priority: "high",
      },
      verdict: "accept",
      reason: "valid",
      impact: "could crash",
      severity: "high",
      impactCategory: "correctness",
      finalPriority: "high",
    },
    {
      reviewerId: "security-reviewer",
      perspective: "security",
      finding: {
        filePath: "src/b.tsx",
        line: 20,
        comment: "xss risk",
        priority: "high",
      },
      verdict: "accept",
      reason: "valid",
      impact: "xss",
      severity: "critical",
      impactCategory: "security",
      finalPriority: "high",
    },
  ],
  reviewerErrors: [],
};

describe("sendTask", () => {
  it("posts a data part with the given payload and returns the task id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ task: { id: "task-1", status: "submitted" } }, 202));

    const taskId = await sendTask(
      "http://localhost:3000/orchestrator",
      "gh-token",
      { owner: "kuju63", repo: "react-seeded", prNumber: 8 },
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(taskId).toBe("task-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/orchestrator/tasks/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer gh-token",
          "content-type": "application/json",
        }),
      }),
    );
    const call = fetchMock.mock.calls[0];
    if (call === undefined) {
      throw new Error("fetch was not called");
    }
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      message: {
        role: "user",
        parts: [{ kind: "data", data: { owner: "kuju63", repo: "react-seeded", prNumber: 8 } }],
      },
    });
  });

  it("throws when the server responds with a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "bad" }, 400));
    await expect(
      sendTask(
        "http://localhost:3000/orchestrator",
        "gh-token",
        { owner: "a", repo: "b", prNumber: 1 },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/400/);
  });

  it("aborts a request that never responds once the deadline is reached", async () => {
    const fetchMock = hangingFetchMock();
    const controller = new AbortController();

    const promise = sendTask(
      "http://localhost:3000/orchestrator",
      "gh-token",
      { owner: "a", repo: "b", prNumber: 1 },
      {
        fetch: fetchMock as unknown as typeof fetch,
        deadline: 0,
        now: () => 0,
        createTimeoutSignal: () => controller.signal,
      },
    );
    controller.abort();

    await expect(promise).rejects.toThrow(/abort/i);
  });
});

describe("pollTask", () => {
  it("polls until completed and returns the parsed LeadEngineerReport", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ id: "task-1", status: "working", message: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "task-1",
          status: "completed",
          message: { role: "agent", parts: [{ kind: "data", data: leadReport }] },
          error: null,
        }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    const report = await pollTask("http://localhost:3000/orchestrator", "gh-token", "task-1", {
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
      pollIntervalMs: 10,
      deadline: 5000,
      now: () => 0,
    });

    expect(report.overallSummary).toBe("looks fine");
    expect(report.decisions).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws when the task status becomes failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: "task-1", status: "failed", message: null, error: "boom" }),
      );

    await expect(
      pollTask("http://localhost:3000/orchestrator", "gh-token", "task-1", {
        fetch: fetchMock as unknown as typeof fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
        pollIntervalMs: 10,
        deadline: 5000,
        now: () => 0,
      }),
    ).rejects.toThrow(/boom/);
  });

  it("throws a timeout error once the deadline elapses", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ id: "task-1", status: "working", message: null, error: null }),
      );
    let now = 0;
    const sleep = vi.fn().mockImplementation(async () => {
      now += 20;
    });

    await expect(
      pollTask("http://localhost:3000/orchestrator", "gh-token", "task-1", {
        fetch: fetchMock as unknown as typeof fetch,
        sleep,
        pollIntervalMs: 10,
        deadline: 15,
        now: () => now,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it("aborts an in-flight poll once the deadline is reached", async () => {
    const fetchMock = hangingFetchMock();
    const controller = new AbortController();

    const promise = pollTask("http://localhost:3000/orchestrator", "gh-token", "task-1", {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: vi.fn().mockResolvedValue(undefined),
      pollIntervalMs: 10,
      deadline: 5,
      now: () => 0,
      createTimeoutSignal: () => controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow(/abort/i);
  });
});

describe("evaluateItem", () => {
  it("sends the task, polls to completion, and converts to predictions format", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: { id: "task-1", status: "submitted" } }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "task-1",
          status: "completed",
          message: { role: "agent", parts: [{ kind: "data", data: leadReport }] },
          error: null,
        }),
      );

    const pred = await evaluateItem(
      { id: "seeded::kuju63/react-seeded#8", repository: "kuju63/react-seeded", pr_number: 8 },
      {
        baseUrl: "http://localhost:3000",
        githubToken: "gh-token",
        fetch: fetchMock as unknown as typeof fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
        pollIntervalMs: 10,
        timeoutMs: 5000,
        now: () => 0,
      },
    );

    expect(pred.id).toBe("seeded::kuju63/react-seeded#8");
    expect(pred.agent_findings).toHaveLength(2);
    // Sorted by severity (critical first): security stays "security", technical -> "unknown".
    expect(pred.agent_findings[0]?.category).toBe("security");
    expect(pred.agent_findings[1]?.category).toBe("unknown");
  });
});

describe("evaluateConcurrently", () => {
  it("preserves input order regardless of completion order and respects the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const delays: Record<string, number> = { a: 30, b: 10, c: 20, d: 5 };

    const results = await evaluateConcurrently(
      items,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, delays[item.id]));
        active -= 1;
        return { id: item.id, agent_findings: [], lead_decisions: [] };
      },
      2,
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.predictions.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(results.failedIds).toEqual([]);
  });

  it("collects failed ids without aborting the other items", async () => {
    const items = [{ id: "a" }, { id: "b" }];
    const results = await evaluateConcurrently(
      items,
      async (item) => {
        if (item.id === "a") {
          throw new Error("boom");
        }
        return { id: item.id, agent_findings: [], lead_decisions: [] };
      },
      2,
    );

    expect(results.predictions.map((p) => p.id)).toEqual(["b"]);
    expect(results.failedIds).toEqual(["a"]);
  });
});

describe("writePredictionsAndSidecar", () => {
  it("writes the predictions JSONL and the failed_ids sidecar", async () => {
    const directory = makeTempDirectory();
    const outputPath = join(directory, "agent_predictions.jsonl");

    await writePredictionsAndSidecar(
      outputPath,
      [{ id: "a", agent_findings: [], lead_decisions: [] }],
      ["b"],
    );

    const predLines = readFileSync(outputPath, "utf-8").trim().split("\n");
    expect(predLines).toHaveLength(1);
    expect(JSON.parse(predLines[0] as string)).toEqual({
      id: "a",
      agent_findings: [],
      lead_decisions: [],
    });

    const sidecarPath = join(directory, "agent_predictions.failed_ids.json");
    expect(JSON.parse(readFileSync(sidecarPath, "utf-8"))).toEqual(["b"]);
  });
});

describe("main", () => {
  it("returns 2 when GITHUB_TOKEN is not set", async () => {
    const status = await main(
      ["node", "run-agent-evaluation", "--seeded", "x.jsonl", "--pred", "y.jsonl"],
      {
        env: {},
      },
    );
    expect(status).toBe(2);
  });

  it("reads the seeded set, evaluates every item, and writes predictions + sidecar", async () => {
    const directory = makeTempDirectory();
    const seededPath = join(directory, "seeded.jsonl");
    const outputPath = join(directory, "pred.jsonl");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      seededPath,
      `${JSON.stringify({ id: "seeded::kuju63/react-seeded#8", repository: "kuju63/react-seeded", pr_number: 8 })}\n`,
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task: { id: "task-1", status: "submitted" } }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "task-1",
          status: "completed",
          message: { role: "agent", parts: [{ kind: "data", data: leadReport }] },
          error: null,
        }),
      );

    const status = await main(
      [
        "node",
        "run-agent-evaluation",
        "--seeded",
        seededPath,
        "--pred",
        outputPath,
        "--base-url",
        "http://localhost:3000",
        "--poll-interval",
        "0",
      ],
      {
        env: { GITHUB_TOKEN: "gh-token" },
        fetch: fetchMock as unknown as typeof fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(status).toBe(0);
    const predLines = readFileSync(outputPath, "utf-8").trim().split("\n");
    expect(predLines).toHaveLength(1);
    expect(JSON.parse(predLines[0] as string).id).toBe("seeded::kuju63/react-seeded#8");
  });

  it.each([
    ["--concurrency", "0"],
    ["--concurrency", "-1"],
    ["--concurrency", "abc"],
    ["--concurrency", "1.5"],
    ["--poll-interval", "-1"],
    ["--poll-interval", "abc"],
    ["--timeout", "0"],
    ["--timeout", "-1"],
    ["--timeout", "abc"],
  ])("returns 2 when %s %s is invalid", async (flag, value) => {
    const status = await main(
      ["node", "run-agent-evaluation", "--seeded", "x.jsonl", "--pred", "y.jsonl", flag, value],
      { env: { GITHUB_TOKEN: "gh-token" } },
    );
    expect(status).toBe(2);
  });
});
