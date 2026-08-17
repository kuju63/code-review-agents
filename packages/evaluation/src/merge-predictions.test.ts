import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failedIdsPath, merge, run } from "./merge-predictions.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "merge-predictions-"));
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * `setupLogging` is a first-call-wins singleton (packages/evaluation/src/lib/logging.ts),
 * so a static import of `merge` shares logging state with every other test
 * in this process. Reset the module registry and re-import both `merge`
 * and `logging` so this test's `setupLogging` call is the first one that
 * module instance sees.
 */
async function freshMerge() {
  const write = vi.fn<(chunk: string) => boolean>(() => true);
  const { setupLogging } = await import("./lib/logging.js");
  setupLogging("info", { stream: { write } });
  const { merge: freshMergeFn } = await import("./merge-predictions.js");
  return { merge: freshMergeFn, write };
}

async function writeJsonl(path: string, rows: Record<string, unknown>[]): Promise<void> {
  await writeFile(
    path,
    rows.length > 0 ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : "",
    "utf-8",
  );
}

async function writeSidecar(predPath: string, failedIds: string[]): Promise<void> {
  await writeFile(failedIdsPath(predPath), JSON.stringify(failedIds), "utf-8");
}

async function readIds(path: string): Promise<string[]> {
  const content = await readFile(path, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => (JSON.parse(line) as { id: string }).id);
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

describe("failedIdsPath", () => {
  it("derives the sidecar path from the predictions stem", () => {
    expect(failedIdsPath("evaluation/data/agent_predictions.jsonl")).toBe(
      "evaluation/data/agent_predictions.failed_ids.json",
    );
  });
});

describe("merge happy path", () => {
  it("merges two shards preserving Gold+Seeded order", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, [{ id: "s1" }]);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g2", agent_findings: [] }]);
    await writeSidecar(shard0, []);
    const shard1 = join(dir, "shard1.jsonl");
    await writeJsonl(shard1, [
      { id: "g1", agent_findings: [] },
      { id: "s1", agent_findings: [] },
    ]);
    await writeSidecar(shard1, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0, shard1],
      allowMissing: false,
    });

    expect(exitCode).toBe(0);
    expect(await readIds(output)).toEqual(["g1", "g2", "s1"]);
    const sidecar = JSON.parse(await readFile(join(dir, "merged.failed_ids.json"), "utf-8"));
    expect(sidecar).toEqual([]);
  });
});

describe("merge duplicate ids", () => {
  it("treats a duplicate id across shards as fatal", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, []);
    const shard1 = join(dir, "shard1.jsonl");
    await writeJsonl(shard1, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard1, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0, shard1],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });
});

describe("merge unaccounted ids", () => {
  it("treats an unaccounted id as fatal by default", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, []);
    // shard1 was supposed to cover g2 but never ran: no predictions row, no
    // sidecar entry.

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });

  it("downgrades an unaccounted id to a warning with --allow-missing", async () => {
    const { merge, write } = await freshMerge();

    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: true,
    });

    expect(exitCode).toBe(1);
    expect(await exists(output)).toBe(true);
    const sidecar = JSON.parse(await readFile(join(dir, "merged.failed_ids.json"), "utf-8"));
    expect(sidecar).toEqual(["g2"]);
    const messages = write.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("g2"))).toBe(true);
  });

  it("does not treat a known failed id as fatal without --allow-missing", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, ["g2"]);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(1);
    expect(await readIds(output)).toEqual(["g1"]);
    const sidecar = JSON.parse(await readFile(join(dir, "merged.failed_ids.json"), "utf-8"));
    expect(sidecar).toEqual(["g2"]);
  });

  it("does not mention --allow-missing in the summary when it was not provided", async () => {
    const { merge, write } = await freshMerge();

    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, ["g2"]);

    const output = join(dir, "merged.jsonl");
    await merge({ gold, seeded, output, predPaths: [shard0], allowMissing: false });

    const messages = write.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("--allow-missing"))).toBe(false);
  });

  it("treats gaps from a missing sidecar file as unaccounted", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    // No sidecar written at all for shard0.

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });
});

describe("merge unexpected ids", () => {
  it("treats an id outside Gold/Seeded as fatal even with --allow-missing", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [
      { id: "g1", agent_findings: [] },
      { id: "not-in-gold-or-seeded", agent_findings: [] },
    ]);
    await writeSidecar(shard0, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: true,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });
});

describe("merge missing shard file", () => {
  it("treats a shard file that was never written as unaccounted, not a crash", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, []);
    const shard1 = join(dir, "shard1.jsonl"); // never created

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0, shard1],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });

  it("accepts a missing shard file with --allow-missing", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }, { id: "g2" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, []);
    const shard1 = join(dir, "shard1.jsonl"); // never created

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0, shard1],
      allowMissing: true,
    });

    expect(exitCode).toBe(1);
    expect(await readIds(output)).toEqual(["g1"]);
  });
});

describe("merge input validation", () => {
  it("rejects a Gold row with no id, naming the file and row index", async () => {
    const { merge, write } = await freshMerge();
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ title: "missing id" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
    const messages = write.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("gold.jsonl") && m.includes("[0]"))).toBe(true);
  });

  it("rejects a Seeded row with a non-string id", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, [{ id: 42 }]);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });

  it("rejects a shard prediction row with no id", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ agent_findings: [] }]);
    await writeSidecar(shard0, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });

  it("rejects a failed_ids sidecar that is not a JSON array", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeFile(failedIdsPath(shard0), JSON.stringify({ not: "an array" }), "utf-8");

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });

  it("rejects a failed_ids sidecar containing a non-string element", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeFile(failedIdsPath(shard0), JSON.stringify(["g2", 3]), "utf-8");

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(2);
    expect(await exists(output)).toBe(false);
  });

  it("writes one output line per expected-item occurrence, matching the Python original's behavior when Gold and Seeded share an id", async () => {
    // Not a recommended input shape (Gold/Seeded ids are expected to be
    // disjoint), but merge_predictions.py's own `for item in expected_items`
    // write loop has always duplicated the line in this case -- see
    // evaluation/tools/merge_predictions.py:145-148. This test locks in that
    // pre-existing behavior rather than silently changing it.
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "shared" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, [{ id: "shared" }]);

    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "shared", agent_findings: [] }]);
    await writeSidecar(shard0, []);

    const output = join(dir, "merged.jsonl");
    const exitCode = await merge({
      gold,
      seeded,
      output,
      predPaths: [shard0],
      allowMissing: false,
    });

    expect(exitCode).toBe(0);
    expect(await readIds(output)).toEqual(["shared", "shared"]);
  });
});

describe("run (CLI)", () => {
  it("parses flags and positional shard paths and merges successfully", async () => {
    const gold = join(dir, "gold.jsonl");
    await writeJsonl(gold, [{ id: "g1" }]);
    const seeded = join(dir, "seeded.jsonl");
    await writeJsonl(seeded, []);
    const shard0 = join(dir, "shard0.jsonl");
    await writeJsonl(shard0, [{ id: "g1", agent_findings: [] }]);
    await writeSidecar(shard0, []);
    const output = join(dir, "merged.jsonl");

    const exitCode = await run(["--gold", gold, "--seeded", seeded, "--output", output, shard0]);

    expect(exitCode).toBe(0);
    expect(await readIds(output)).toEqual(["g1"]);
  });

  it("returns 2 when a required option is missing", async () => {
    const exitCode = await run(["--gold", "gold.jsonl", "--output", "out.jsonl", "shard0.jsonl"]);
    expect(exitCode).toBe(2);
  });
});
