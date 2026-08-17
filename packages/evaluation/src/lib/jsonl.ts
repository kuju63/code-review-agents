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

/** Write `content` to `outputPath` via a temp-file-then-rename so readers never see a partial write. */
async function writeFileAtomic(outputPath: string, content: string): Promise<void> {
  const directory = dirname(outputPath) || ".";
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(outputPath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: "utf-8", flag: "wx" });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonlAtomic(
  outputPath: string,
  rows: readonly unknown[],
): Promise<void> {
  const body = rows.map(serializeRow).join("\n");
  await writeFileAtomic(outputPath, rows.length > 0 ? `${body}\n` : "");
}

export async function writeJsonAtomic(outputPath: string, data: unknown): Promise<void> {
  await writeFileAtomic(outputPath, `${JSON.stringify(data, null, 2)}\n`);
}
