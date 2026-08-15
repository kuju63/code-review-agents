import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonl, writeJsonlAtomic } from "./jsonl.js";

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "evaluation-jsonl-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("readJsonl", () => {
  it("parses non-blank lines and preserves JSON values", async () => {
    const directory = await tempDirectory();
    const path = join(directory, "input.jsonl");
    await writeFile(path, '\n {"id":1} \r\n\t\n["two"]\n', "utf-8");

    await expect(readJsonl(path)).resolves.toEqual([{ id: 1 }, ["two"]]);
  });

  it("fails closed on malformed JSON", async () => {
    const directory = await tempDirectory();
    const path = join(directory, "invalid.jsonl");
    await writeFile(path, '{"id":1}\nnot-json\n', "utf-8");

    await expect(readJsonl(path)).rejects.toThrow();
  });
});

describe("writeJsonlAtomic", () => {
  it("creates parent directories and writes one compact JSON value per line", async () => {
    const directory = await tempDirectory();
    const path = join(directory, "nested", "output.jsonl");

    await writeJsonlAtomic(path, [{ id: 1 }, { text: "日本語" }]);

    await expect(readFile(path, "utf-8")).resolves.toBe('{"id":1}\n{"text":"日本語"}\n');
    expect(
      (await readdir(join(directory, "nested"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("writes an empty file for no rows", async () => {
    const directory = await tempDirectory();
    const path = join(directory, "output.jsonl");

    await writeJsonlAtomic(path, []);

    await expect(readFile(path, "utf-8")).resolves.toBe("");
  });

  it("leaves an existing output untouched when serialization fails", async () => {
    const directory = await tempDirectory();
    const path = join(directory, "output.jsonl");
    await writeFile(path, "previous\n", "utf-8");
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(writeJsonlAtomic(path, [circular])).rejects.toThrow();
    await expect(readFile(path, "utf-8")).resolves.toBe("previous\n");
  });
});
