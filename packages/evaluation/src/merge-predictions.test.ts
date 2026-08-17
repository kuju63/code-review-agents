import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogger, setupLogging } from "./lib/logging.js";
import { failedIdsPath, merge, run } from "./merge-predictions.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "merge-predictions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
    const write = vi.fn<(chunk: string) => boolean>(() => true);
    setupLogging("info", { stream: { write } });
    getLogger("merge_predictions");

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
    const write = vi.fn<(chunk: string) => boolean>(() => true);
    setupLogging("info", { stream: { write } });

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
