import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function readJsonl(path: string): Promise<unknown[]> {
  const content = await readFile(path, "utf-8");
  const rows: unknown[] = [];
  for (const line of content.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      rows.push(JSON.parse(trimmed));
    }
  }
  return rows;
}

function serializeRow(row: unknown): string {
  const serialized = JSON.stringify(row);
  if (serialized === undefined) {
    throw new TypeError("JSONL rows must be JSON-serializable values");
  }
  return serialized;
}

export async function writeJsonlAtomic(
  outputPath: string,
  rows: readonly unknown[],
): Promise<void> {
  const directory = dirname(outputPath) || ".";
  await mkdir(directory, { recursive: true });
  const body = rows.map(serializeRow).join("\n");
  const temporaryPath = join(directory, `.${basename(outputPath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, rows.length > 0 ? `${body}\n` : "", {
      encoding: "utf-8",
      flag: "wx",
    });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
