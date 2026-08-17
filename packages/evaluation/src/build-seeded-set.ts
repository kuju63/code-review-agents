#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTargetFile } from "@code-review-agent/agent-core/agents/target-file.js";
import { Command, CommanderError } from "commander";
import { fetchPrFiles as defaultFetchPrFiles } from "./lib/github-rest.js";
import { writeJsonlAtomic as defaultWriteJsonlAtomic } from "./lib/jsonl.js";

const STACKS = new Set(["react", "vue", "angular", "svelte"]);
const CATEGORIES = new Set(["security", "performance", "correctness", "maintainability"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const INTENTIONAL_RE = /INTENTIONAL(?::\s*SEED-\d+)?/;
const BLANK_OR_COMMENT_ONLY_RE = /^\+\s*($|\/\/|\/\*|<!--|#)/;

export interface FileChange {
  path: string;
  patch: string;
}

export interface Defect {
  path: string;
  occurrence: number;
  ruleId: string;
  category: string;
  severity: string;
  summary: string;
  lineOffset: number | null;
}

export interface SeededPrTarget {
  repository: string;
  stack: string;
  prNumber: number;
  defects: Defect[];
}

export interface MarkerHit {
  hunk: readonly string[];
  markerIdx: number;
}

export interface MustFindEntry {
  rule_id: string;
  category: string;
  severity: string;
  path: string;
  line: number;
  summary: string;
}

export interface SeededItem {
  id: string;
  repository: string;
  pr_number: number;
  stack: string;
  file_changes: FileChange[];
  must_find: MustFindEntry[];
}

export type FetchPrFiles = (
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
) => Promise<FileChange[]>;

export type WriteJsonlAtomic = (outputPath: string, rows: readonly unknown[]) => Promise<void>;

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const parts = text.split(/\r\n|\r|\n/);
  if (parts.length > 0 && parts[parts.length - 1] === "" && /(\r\n|\r|\n)$/.test(text)) {
    parts.pop();
  }
  return parts;
}

export function splitHunks(patch: string): string[][] {
  const hunks: string[][] = [];
  for (const line of splitLines(patch)) {
    if (HUNK_HEADER_RE.test(line)) {
      hunks.push([line]);
    } else {
      const current = hunks[hunks.length - 1];
      if (current) {
        current.push(line);
      }
    }
  }
  return hunks;
}

export function parseHunkNewStart(headerLine: string): number {
  const match = HUNK_HEADER_RE.exec(headerLine);
  const captured = match?.[1];
  return captured === undefined ? 1 : Number.parseInt(captured, 10);
}

export function countNewLinesBefore(hunkLines: readonly string[], insertionIdx: number): number {
  let count = 0;
  const upper = Math.min(insertionIdx, hunkLines.length - 1);
  for (let i = 1; i <= upper; i += 1) {
    const line = hunkLines[i];
    if (line !== undefined && (line.startsWith(" ") || line.startsWith("+"))) {
      count += 1;
    }
  }
  return count;
}

export function detectIntentionalMarkers(patch: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  for (const hunk of splitHunks(patch)) {
    for (let idx = 1; idx < hunk.length; idx += 1) {
      const line = hunk[idx];
      if (line?.startsWith("+") && INTENTIONAL_RE.test(line)) {
        hits.push({ hunk, markerIdx: idx });
      }
    }
  }
  return hits;
}

export function resolveDefectLine(hit: MarkerHit, lineOffset: number | null = null): number {
  const hunk = hit.hunk;
  let defectIdx: number;
  if (lineOffset !== null && lineOffset !== undefined) {
    if (lineOffset <= 0) {
      throw new Error(
        `line_offset must be positive (a defect is always after its marker), got ${lineOffset}`,
      );
    }
    defectIdx = hit.markerIdx + lineOffset;
  } else {
    defectIdx = hit.markerIdx + 1;
    while (defectIdx < hunk.length) {
      const line = hunk[defectIdx];
      if (line?.startsWith("+") && !BLANK_OR_COMMENT_ONLY_RE.test(line)) {
        break;
      }
      defectIdx += 1;
    }
    if (defectIdx >= hunk.length) {
      throw new Error("no defect line found after INTENTIONAL marker");
    }
  }

  const defectLine = hunk[defectIdx];
  if (defectLine === undefined || !defectLine.startsWith("+")) {
    throw new Error(`line_offset resolves outside an added line: idx=${defectIdx}`);
  }
  const header = hunk[0] ?? "";
  return parseHunkNewStart(header) + countNewLinesBefore(hunk, defectIdx) - 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedList(values: Iterable<string>): string {
  return [...values].sort().join(", ");
}

export function loadTargets(paths: string[]): SeededPrTarget[] {
  const targets: SeededPrTarget[] = [];
  for (const path of paths) {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(raw)) {
      throw new Error(`${path}: JSON must be an object`);
    }

    for (const key of ["repository", "stack", "prs"]) {
      if (!(key in raw)) {
        throw new Error(`${path}: missing required key '${key}'`);
      }
    }

    const repository = String(raw.repository);
    const stack = String(raw.stack);
    if (!STACKS.has(stack)) {
      throw new Error(`${path}: invalid stack '${stack}'; expected one of: ${sortedList(STACKS)}`);
    }

    if (!Array.isArray(raw.prs)) {
      throw new Error(`${path}: 'prs' must be an array`);
    }
    const prs = raw.prs;
    for (const prItem of prs) {
      if (!isRecord(prItem) || !("pr_number" in prItem)) {
        throw new Error(`${path}: ${repository}: PR entry missing required key 'pr_number'`);
      }
      const prNumber = Number(prItem.pr_number);
      if (!Number.isInteger(prNumber)) {
        throw new Error(`${path}: ${repository}: invalid pr_number '${String(prItem.pr_number)}'`);
      }
      const defects: Defect[] = [];
      const rawDefects = Array.isArray(prItem.defects) ? prItem.defects : [];
      for (const d of rawDefects) {
        const defectRecord = isRecord(d) ? d : {};
        for (const key of ["path", "rule_id", "category", "severity", "summary"]) {
          if (!(key in defectRecord)) {
            throw new Error(
              `${path}: ${repository}#${prNumber}: defect missing required key '${key}'`,
            );
          }
        }
        const category = String(defectRecord.category);
        const severity = String(defectRecord.severity);
        if (!CATEGORIES.has(category)) {
          throw new Error(
            `${path}: ${repository}#${prNumber}: invalid category '${category}'; expected one of: ${sortedList(CATEGORIES)}`,
          );
        }
        if (!SEVERITIES.has(severity)) {
          throw new Error(
            `${path}: ${repository}#${prNumber}: invalid severity '${severity}'; expected one of: ${sortedList(SEVERITIES)}`,
          );
        }
        const rawOffset = defectRecord.line_offset;
        const occurrence =
          defectRecord.occurrence === undefined ? 0 : Number(defectRecord.occurrence);
        if (!Number.isInteger(occurrence) || occurrence < 0) {
          throw new Error(
            `${path}: ${repository}#${prNumber}: invalid occurrence '${String(defectRecord.occurrence)}'; expected a non-negative integer`,
          );
        }
        defects.push({
          path: String(defectRecord.path),
          occurrence,
          ruleId: String(defectRecord.rule_id),
          category,
          severity,
          summary: String(defectRecord.summary),
          lineOffset: rawOffset === undefined || rawOffset === null ? null : Number(rawOffset),
        });
      }
      if (defects.length === 0) {
        throw new Error(`${path}: ${repository}#${prNumber} has no defects`);
      }

      targets.push({ repository, stack, prNumber, defects });
    }
  }
  return targets;
}

function markerKey(path: string, occurrence: number): string {
  return `${path}\u0000${occurrence}`;
}

function resolveHit(hits: readonly MarkerHit[], occurrence: number): MarkerHit | undefined {
  return hits[occurrence];
}

export function buildSeededItemFromFiles(target: SeededPrTarget, files: FileChange[]): SeededItem {
  const patchByPath = new Map<string, string>();
  for (const file of files) {
    patchByPath.set(file.path, file.patch);
  }

  const markersByPath = new Map<string, MarkerHit[]>();
  for (const [path, patch] of patchByPath.entries()) {
    const hits = detectIntentionalMarkers(patch);
    if (hits.length > 0) {
      markersByPath.set(path, hits);
    }
  }

  let totalMarkers = 0;
  for (const hits of markersByPath.values()) {
    totalMarkers += hits.length;
  }
  if (totalMarkers === 0) {
    throw new Error(`no INTENTIONAL marker found in ${target.repository}#${target.prNumber}`);
  }
  if (totalMarkers !== target.defects.length) {
    throw new Error(
      `${target.repository}#${target.prNumber}: found ${totalMarkers} marker(s) but metadata declares ${target.defects.length} defect(s)`,
    );
  }

  const mustFind: MustFindEntry[] = [];
  const consumed = new Set<string>();
  for (const defect of target.defects) {
    const key = markerKey(defect.path, defect.occurrence);
    if (consumed.has(key)) {
      throw new Error(
        `${target.repository}#${target.prNumber}: duplicate defect declared for path='${defect.path}' occurrence=${defect.occurrence}`,
      );
    }
    consumed.add(key);

    const hits = markersByPath.get(defect.path);
    const hit = hits ? resolveHit(hits, defect.occurrence) : undefined;
    if (!hit) {
      throw new Error(
        `${target.repository}#${target.prNumber}: no marker at path='${defect.path}' occurrence=${defect.occurrence}`,
      );
    }
    if (!isTargetFile(defect.path)) {
      throw new Error(
        `${target.repository}#${target.prNumber}: marker file '${defect.path}' is excluded by isTargetFile and would never reach a reviewer`,
      );
    }
    const line = resolveDefectLine(hit, defect.lineOffset);
    mustFind.push({
      rule_id: defect.ruleId,
      category: defect.category,
      severity: defect.severity,
      path: defect.path,
      line,
      summary: defect.summary,
    });
  }

  const unconsumed: string[] = [];
  for (const [path, hits] of markersByPath.entries()) {
    for (let occurrence = 0; occurrence < hits.length; occurrence += 1) {
      if (!consumed.has(markerKey(path, occurrence))) {
        unconsumed.push(`(${path}, ${occurrence})`);
      }
    }
  }
  if (unconsumed.length > 0) {
    unconsumed.sort();
    throw new Error(
      `${target.repository}#${target.prNumber}: marker(s) not covered by metadata: [${unconsumed.join(", ")}]`,
    );
  }

  return {
    id: `seeded::${target.repository}#${target.prNumber}`,
    repository: target.repository,
    pr_number: target.prNumber,
    stack: target.stack,
    file_changes: files,
    must_find: mustFind,
  };
}

function splitRepository(repository: string): [string, string] {
  const idx = repository.indexOf("/");
  if (idx === -1) {
    throw new Error(`repository must use owner/repo format: ${repository}`);
  }
  return [repository.slice(0, idx), repository.slice(idx + 1)];
}

export async function buildSeededItem(
  target: SeededPrTarget,
  token: string,
  fetchPrFiles: FetchPrFiles = defaultFetchPrFiles,
): Promise<SeededItem> {
  const [owner, repo] = splitRepository(target.repository);
  const files = await fetchPrFiles(owner, repo, target.prNumber, token);
  return buildSeededItemFromFiles(target, files);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function printMarkers(
  target: SeededPrTarget,
  token: string,
  fetchPrFiles: FetchPrFiles,
  stdout: (line: string) => void,
): Promise<void> {
  const [owner, repo] = splitRepository(target.repository);
  const files = await fetchPrFiles(owner, repo, target.prNumber, token);
  stdout(`${target.repository}#${target.prNumber}:`);
  for (const file of files) {
    const hits = detectIntentionalMarkers(file.patch);
    hits.forEach((hit, occurrence) => {
      try {
        const line = resolveDefectLine(hit);
        stdout(`  path=${file.path} occurrence=${occurrence} line=${line}`);
      } catch (error) {
        stdout(`  path=${file.path} occurrence=${occurrence} ERROR: ${errorMessage(error)}`);
      }
    });
  }
}

export function parsePrFilter(value: string): [string, number] {
  const idx = value.lastIndexOf("#");
  const repository = idx === -1 ? "" : value.slice(0, idx);
  const prPart = idx === -1 ? value : value.slice(idx + 1);
  if (!/^[+-]?\d+$/.test(prPart.trim())) {
    throw new Error(`invalid PR number: ${prPart}`);
  }
  return [repository, Number.parseInt(prPart, 10)];
}

function collectPath(value: string, previous: string[] | undefined): string[] {
  return (previous ?? []).concat(value);
}

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export interface RunDeps {
  fetchPrFiles?: FetchPrFiles;
  writeJsonlAtomic?: WriteJsonlAtomic;
  sleep?: (seconds: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  logError?: (message: string) => void;
}

interface ParsedOptions {
  targets: string[];
  output?: string;
  stacks?: string;
  pr?: string;
  printMarkers?: boolean;
  sleep: number;
}

export async function runBuildSeededSet(argv: string[], deps: RunDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const logError =
    deps.logError ?? ((message: string) => void process.stderr.write(`${message}\n`));
  const fetchPrFiles = deps.fetchPrFiles ?? defaultFetchPrFiles;
  const writeJsonlAtomic = deps.writeJsonlAtomic ?? defaultWriteJsonlAtomic;
  const sleep = deps.sleep ?? defaultSleep;

  const program = new Command();
  program
    .name("build-seeded-set")
    .description("Build Seeded set from dedicated seed repositories (Issue #224)")
    .requiredOption(
      "--targets <paths...>",
      "Path(s) to seeded_pr_targets_{stack}.json",
      collectPath,
    )
    .option("--output <path>", "Path to output Seeded JSONL")
    .option("--stacks <stacks>", "Comma-separated stack filter")
    .option("--pr <pr>", 'Process a single PR only, e.g. "kuju63/vue-seeded#13"')
    .option("--print-markers", "Print detected markers instead of building must_find")
    .option("--sleep <seconds>", "Sleep between API calls", Number.parseFloat, 0.2)
    .allowExcessArguments(false)
    .exitOverride();
  program.configureOutput({
    writeErr: (str: string) => logError(str.replace(/\n$/, "")),
    writeOut: (str: string) => stdout(str.replace(/\n$/, "")),
  });

  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    throw error;
  }

  const options = program.opts<ParsedOptions>();

  const token = env.GITHUB_TOKEN;
  if (!token) {
    logError("GITHUB_TOKEN is required");
    return 2;
  }
  if (!Number.isFinite(options.sleep) || options.sleep < 0) {
    logError("--sleep must be a finite non-negative number");
    return 2;
  }

  let targets = loadTargets(options.targets);

  if (options.stacks) {
    const wanted = new Set(options.stacks.split(","));
    targets = targets.filter((t) => wanted.has(t.stack));
  }

  if (options.pr) {
    const [repository, prNumber] = parsePrFilter(options.pr);
    targets = targets.filter((t) => t.repository === repository && t.prNumber === prNumber);
    if (targets.length === 0) {
      logError(`no target matches --pr ${options.pr}`);
      return 2;
    }
  }

  if (options.printMarkers) {
    for (const target of targets) {
      await printMarkers(target, token, fetchPrFiles, stdout);
      await sleep(options.sleep);
    }
    return 0;
  }

  if (!options.output) {
    logError("--output is required unless --print-markers is set");
    return 2;
  }

  const items: SeededItem[] = [];
  for (const target of targets) {
    items.push(await buildSeededItem(target, token, fetchPrFiles));
    await sleep(options.sleep);
  }

  await writeJsonlAtomic(options.output, items);

  logError(`Done. Seeded items: ${items.length}`);
  return 0;
}

export function isDirectExecution(
  metaUrl: string = import.meta.url,
  entrypoint: string | undefined = process.argv[1],
): boolean {
  return (
    entrypoint !== undefined && realpathSync(fileURLToPath(metaUrl)) === realpathSync(entrypoint)
  );
}

export async function main(): Promise<number> {
  return runBuildSeededSet(process.argv.slice(2));
}

if (isDirectExecution()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
