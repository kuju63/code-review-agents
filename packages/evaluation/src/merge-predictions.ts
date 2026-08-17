#!/usr/bin/env node
/**
 * Merge shard predictions.jsonl files produced by run_agent_evaluation.py.
 *
 * Usage:
 *   merge-predictions --gold evaluation/data/gold_pr_set.jsonl \
 *     --seeded evaluation/data/seeded_set.jsonl \
 *     --output evaluation/data/agent_predictions.jsonl \
 *     shard0.jsonl shard1.jsonl shard2.jsonl shard3.jsonl
 *
 * Each shard file must have a failed_ids sidecar next to it
 * (<shard>.failed_ids.json, written automatically by run_agent_evaluation.py).
 * An id present in neither the merged predictions nor any sidecar is
 * "unaccounted" -- most likely a shard invocation that was killed mid-run by
 * an external time limit before it could write anything -- and is fatal by
 * default. Pass --allow-missing to downgrade that to a warning when partial
 * results are acceptable. See docs/eval-sharded-execution-spec.md §2.4.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { getLogger } from "./lib/logging.js";

const logger = getLogger("merge_predictions");

type Row = Record<string, unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validate every row's `id` is a non-empty string, naming `path`+index on the first violation. */
function validateRowIds(rows: readonly Row[], path: string): string | undefined {
  for (const [index, row] of rows.entries()) {
    if (!isNonEmptyString(row.id)) {
      return `invalid id at ${path}[${index}]: ${JSON.stringify(row.id)}`;
    }
  }
  return undefined;
}

async function readJsonl(path: string): Promise<Row[]> {
  const content = await readFile(path, "utf-8");
  const rows: Row[] = [];
  for (const line of content.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      rows.push(JSON.parse(trimmed) as Row);
    }
  }
  return rows;
}

/**
 * Sidecar path recording ids that raised during evaluation.
 *
 * Naming convention shared with run_agent_evaluation.py and
 * generate_evaluation_report.py: ``agent_predictions.jsonl`` ->
 * ``agent_predictions.failed_ids.json``.
 *
 * Returns the sidecar path derived from *predPath*.
 */
export function failedIdsPath(predPath: string): string {
  const directory = dirname(predPath);
  const stem = basename(predPath, extname(predPath));
  return join(directory, `${stem}.failed_ids.json`);
}

export interface MergeOptions {
  gold: string;
  seeded: string;
  output: string;
  predPaths: readonly string[];
  allowMissing: boolean;
}

/**
 * Merge `predPaths` into `output`, validating id coverage.
 *
 * Returns 0 if every expected id was produced with no failures, 1 if some
 * ids are missing but fully accounted for (known failures, or unaccounted
 * ids explicitly allowed via `allowMissing`), or 2 for a fatal error
 * (duplicate id, an id outside Gold/Seeded, or an unaccounted id without
 * `allowMissing`) -- in which case `output` is not written.
 */
export async function merge(options: MergeOptions): Promise<number> {
  const { gold, seeded, output, predPaths, allowMissing } = options;
  const goldRows = await readJsonl(gold);
  const seededRows = await readJsonl(seeded);
  const idError = validateRowIds(goldRows, gold) ?? validateRowIds(seededRows, seeded);
  if (idError) {
    logger.error(idError);
    return 2;
  }
  const expectedItems = [...goldRows, ...seededRows];
  const expectedIds = new Set(expectedItems.map((item) => item.id as string));

  const merged = new Map<string, Row>();
  const mergedSource = new Map<string, string>();
  const duplicates: [string, string, string][] = [];

  for (const predPath of predPaths) {
    // A shard killed mid-run (the exact failure mode this tool exists to
    // detect) may never have created its output file at all -- treat that
    // the same as an empty predictions file rather than crashing, so its
    // ids fall through to the unaccounted/known-failed check below instead
    // of an uncaught error.
    if (!existsSync(predPath)) {
      logger.warn(
        `Predictions file not found: ${predPath} (shard likely never completed); its ids will be treated as unaccounted.`,
      );
      continue;
    }
    const predRows = await readJsonl(predPath);
    const predIdError = validateRowIds(predRows, predPath);
    if (predIdError) {
      logger.error(predIdError);
      return 2;
    }
    for (const row of predRows) {
      const rid = row.id as string;
      if (merged.has(rid)) {
        duplicates.push([rid, mergedSource.get(rid) as string, predPath]);
      } else {
        merged.set(rid, row);
        mergedSource.set(rid, predPath);
      }
    }
  }

  if (duplicates.length > 0) {
    logger.error("Duplicate id(s) found across shard files:");
    for (const [rid, first, dup] of duplicates) {
      logger.error(`  - ${rid}: present in both ${first} and ${dup}`);
    }
    return 2;
  }

  const unexpectedIds = [...merged.keys()].filter((id) => !expectedIds.has(id));
  if (unexpectedIds.length > 0) {
    logger.error(
      "id(s) present in predictions but not in --gold/--seeded (likely a mismatched --gold/--seeded pairing for this shard set):",
    );
    for (const rid of unexpectedIds.sort()) {
      logger.error(`  - ${rid}`);
    }
    return 2;
  }

  const knownFailed = new Set<string>();
  for (const predPath of predPaths) {
    const sidecar = failedIdsPath(predPath);
    if (existsSync(sidecar)) {
      const parsed: unknown = JSON.parse(await readFile(sidecar, "utf-8"));
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
        logger.error(`failed_ids sidecar at ${sidecar} must be a JSON array of strings`);
        return 2;
      }
      for (const id of parsed) {
        knownFailed.add(id);
      }
    } else {
      logger.warn(
        `No failed_ids sidecar found for ${predPath}; any of its gaps will be treated as unaccounted.`,
      );
    }
  }

  const missing = [...expectedIds].filter((id) => !merged.has(id));
  const missingSet = new Set(missing);
  const unaccounted = missing.filter((id) => !knownFailed.has(id));
  if (unaccounted.length > 0 && !allowMissing) {
    logger.error(
      "Unaccounted id(s): present in neither the merged predictions nor any shard's failed_ids sidecar. This usually means a shard was never run (--shard-count mismatch) or was killed mid-run. Pass --allow-missing to accept this as a partial result.",
    );
    for (const rid of [...unaccounted].sort()) {
      logger.error(`  - ${rid}`);
    }
    return 2;
  }

  await mkdir(dirname(output), { recursive: true });
  const lines: string[] = [];
  for (const item of expectedItems) {
    const rid = item.id as string;
    if (merged.has(rid)) {
      lines.push(JSON.stringify(merged.get(rid)));
    }
  }
  await writeFile(output, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf-8");
  await writeFile(failedIdsPath(output), JSON.stringify([...missingSet].sort()), "utf-8");

  // "allowed via --allow-missing" is only accurate -- and only printed --
  // when the flag was actually what let this merge through with a
  // non-empty unaccounted set; otherwise it falsely implies the flag was
  // active for a merge that succeeded purely on known failures (or had no
  // gaps at all).
  const unaccountedDetail =
    allowMissing && unaccounted.length > 0
      ? `${unaccounted.length} unaccounted allowed via --allow-missing`
      : `${unaccounted.length} unaccounted`;
  const knownFailedInMissing = missing.filter((id) => knownFailed.has(id)).length;
  logger.info(
    `Merged ${merged.size}/${expectedIds.size} items (${knownFailedInMissing} known failure(s), ${unaccountedDetail}) -> ${output}`,
  );
  if (missing.length > 0) {
    logger.info("Missing ids (recorded in the merged failed_ids sidecar):");
    for (const rid of [...missing].sort()) {
      logger.info(`  - ${rid}`);
    }
  }

  return missing.length > 0 ? 1 : 0;
}

interface ParsedOptions {
  gold: string;
  seeded: string;
  output: string;
  allowMissing: boolean;
}

export async function run(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("merge-predictions")
    .description("Merge shard predictions.jsonl files into one")
    .requiredOption("--gold <path>", "Gold JSONL path")
    .requiredOption("--seeded <path>", "Seeded JSONL path")
    .requiredOption("--output <path>", "Merged predictions JSONL path")
    .option(
      "--allow-missing",
      "Downgrade unaccounted ids (present in neither predictions nor any failed_ids sidecar) from a fatal error to a warning. Off by default so a shard killed mid-run by an external time limit isn't silently swallowed.",
      false,
    )
    .argument("<pred...>", "Shard predictions.jsonl paths")
    .allowExcessArguments(false)
    .exitOverride();

  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    throw error;
  }

  const options = program.opts<ParsedOptions>();
  const predPaths = program.args as string[];

  return merge({
    gold: options.gold,
    seeded: options.seeded,
    output: options.output,
    predPaths,
    allowMissing: options.allowMissing,
  });
}

export function isDirectExecution(
  metaUrl: string = import.meta.url,
  entrypoint: string | undefined = process.argv[1],
): boolean {
  return entrypoint !== undefined && metaUrl === pathToFileURL(entrypoint).href;
}

export async function main(): Promise<number> {
  return run(process.argv.slice(2));
}

if (isDirectExecution()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
