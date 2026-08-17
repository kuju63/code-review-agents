#!/usr/bin/env node
/**
 * Score predictions and generate the Markdown evaluation report + Discord
 * notification.
 *
 * Usage:
 *   generate-evaluation-report --gold evaluation/data/gold_pr_set.jsonl \
 *     --seeded evaluation/data/seeded_set.jsonl \
 *     --pred evaluation/data/agent_predictions.jsonl
 *
 * Unlike the Python original (which shells out to the `score-evaluation`
 * CLI as a subprocess -- it used to live in a separate process before the
 * TypeScript migration), this calls score-evaluation.ts's `scoreGold`/
 * `scoreSeeded` directly: they are in the same package, so there is no
 * process boundary to cross and no PATH/timeout/non-JSON-stdout failure
 * mode to guard against. The exit-code contract is unchanged: 5 when the
 * failed_ids sidecar is missing, 4 when scoring throws, 1 when failed_ids
 * is non-empty, 0 on a clean run.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Command, CommanderError } from "commander";
import {
  build_notification_payload,
  type EvaluationScores as DiscordEvaluationScores,
  send_discord_notification,
} from "./discord-notify.js";
import { readJsonl } from "./lib/jsonl.js";
import { getLogger } from "./lib/logging.js";
import { failedIdsPath } from "./merge-predictions.js";
import { scoreGold, scoreSeeded } from "./score-evaluation.js";

const logger = getLogger("generate_evaluation_report");
const execFileAsync = promisify(execFile);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Row = Record<string, unknown>;

interface GoldCounts {
  gold_total: number;
  gold_matched: number;
  pred_total_for_gold: number;
  severity_labeled_pairs: number;
  impact_labeled_pairs: number;
  priority_labeled_pairs: number;
}

interface GoldScoreResult {
  issue_recall: number;
  issue_precision: number;
  severity_agreement: number;
  severity_exact_agreement: number;
  severity_within_one_agreement: number;
  impact_exact_agreement: number;
  priority_exact_agreement: number;
  priority_within_one_agreement: number;
  counts: GoldCounts;
  items: Row[];
}

interface SeededCounts {
  seeded_total: number;
  seeded_detected: number;
  seeded_critical_total: number;
  seeded_critical_missed: number;
}

interface SeededScoreResult {
  must_find_recall: number;
  critical_miss_rate: number;
  counts: SeededCounts;
  items: Row[];
}

export interface EvaluationScores {
  gold: GoldScoreResult;
  seeded: SeededScoreResult;
}

async function readJsonlRows(path: string): Promise<Row[]> {
  return (await readJsonl(path)) as Row[];
}

async function defaultGetCommitHash(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

/**
 * Load the failed-ids list for `predPath`.
 *
 * In the intended pipeline (run_agent_evaluation.ts always writes this
 * sidecar, and merge-predictions.ts enforces its presence before writing a
 * merged one) the sidecar always exists, so a missing one is fatal by
 * default -- mirroring merge-predictions.ts's own default-strict treatment
 * of the same condition -- rather than silently reporting zero failures.
 * Pass `allowMissing` to accept a hand-assembled predictions file that
 * genuinely has no sidecar.
 */
export async function loadFailedIds(
  predPath: string,
  failedIdsFile: string | undefined,
  allowMissing = false,
): Promise<string[]> {
  const path = failedIdsFile ?? failedIdsPath(predPath);
  if (!existsSync(path)) {
    if (!allowMissing) {
      throw new Error(
        `No failed_ids sidecar found at ${path}. Every predictions file produced by run-agent-evaluation or merge-predictions has one; its absence usually means failures are being silently undercounted. Pass --allow-missing-failed-ids to proceed anyway (assumes zero failures).`,
      );
    }
    logger.warn(
      `No failed_ids sidecar found at ${path}; assuming zero failures (--allow-missing-failed-ids was set). Failure counts in the report/notification may be inaccurate.`,
    );
    return [];
  }
  return JSON.parse(await readFile(path, "utf-8"));
}

/** Make `text` safe for one Markdown table cell: collapse whitespace, escape
 * `|`, and truncate (by Unicode code point, not UTF-16 code unit) with an
 * ellipsis. `null`/`undefined` become `""` because call sites read straight
 * from dataset/prediction rows loaded from JSONL with no runtime schema
 * enforcement. */
export function sanitizeCell(text: unknown, maxLen = 100): string {
  const raw = text === null || text === undefined ? "" : String(text);
  const collapsed = raw
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ");
  const escaped = collapsed.replaceAll("|", "\\|");
  const codePoints = [...escaped];
  if (codePoints.length > maxLen) {
    return `${codePoints.slice(0, maxLen - 1).join("")}…`;
  }
  return escaped;
}

function getOr(raw: Row, key: string, fallback: unknown): unknown {
  return key in raw ? raw[key] : fallback;
}

/** Traceability link for one finding: Gold's review-comment `source` URL,
 * or Seeded's `rule_id`, or `-` when neither is present. */
export function refCell(raw: Row): string {
  if (raw.source) {
    return `[source](${raw.source})`;
  }
  if (raw.rule_id) {
    return `\`${raw.rule_id}\``;
  }
  return "-";
}

export function findingRow(kind: string, raw: Row): string {
  const path = sanitizeCell(getOr(raw, "path", ""));
  const line = sanitizeCell(getOr(raw, "line", ""));
  const category = sanitizeCell(getOr(raw, "category", "unknown"));
  const severity = sanitizeCell(getOr(raw, "severity", "unknown"));
  const impact = sanitizeCell(getOr(raw, "impact", "unknown"));
  const priority = sanitizeCell(getOr(raw, "priority", "unknown"));
  const summary = sanitizeCell(getOr(raw, "summary", ""));
  const ref = sanitizeCell(refCell(raw));
  return `| ${kind} | \`${path}:${line}\` | ${category} | ${severity} | ${impact} | ${priority} | ${summary} | ${ref} |`;
}

/** Render one Gold PR or Seeded item's matched/missed/unmatched-agent detail. */
export function renderItemDetail(item: Row, heading: string, expectedLabel: string): string {
  const rows: string[] = [];
  for (const m of item.matched as Row[]) {
    rows.push(findingRow("✅ マッチ", m.expected as Row));
  }
  for (const f of item.missed as Row[]) {
    rows.push(findingRow("❌ 見逃し", f));
  }
  for (const f of item.unmatched_agent as Row[]) {
    rows.push(findingRow("➕ Agentのみ（誤検知とは限らない）", f));
  }

  const body =
    rows.length > 0
      ? "| 種別 | Path:Line | Category | Severity | Impact | Priority | Summary | Ref |\n|---|---|---|---|---|---|---|---|\n" +
        rows.join("\n")
      : "_findings なし_";
  const nExpected = item.expected_total as number;
  const nMatched = (item.matched as unknown[]).length;
  const nMissed = (item.missed as unknown[]).length;
  const nUnmatched = (item.unmatched_agent as unknown[]).length;

  return `### ${heading}\n\n${body}\n\n- ${expectedLabel}: ${nExpected} 件 / マッチ: ${nMatched} 件 / 見逃し: ${nMissed} 件 / Agentのみ: ${nUnmatched} 件\n`;
}

function truncateTitle(title: string, maxLen: number): string {
  return [...title].slice(0, maxLen).join("");
}

export function goldHeading(itemId: string, goldTitleById: Record<string, string>): string {
  const title = goldTitleById[itemId] ?? "";
  return title ? `\`${itemId}\` — ${truncateTitle(title, 50)}` : `\`${itemId}\``;
}

export function seededHeading(
  itemId: string,
  baseSource: string,
  goldTitleById: Record<string, string>,
): string {
  const title = goldTitleById[baseSource] ?? "";
  if (baseSource && title) {
    return `\`${itemId}\`（元PR: \`${baseSource}\` ${truncateTitle(title, 50)}）`;
  }
  if (baseSource) {
    return `\`${itemId}\`（元PR: \`${baseSource}\`）`;
  }
  return `\`${itemId}\``;
}

export function buildReport(
  scores: EvaluationScores,
  goldItems: readonly Row[],
  seededItems: readonly Row[],
  commitHash: string,
  modelId: string,
  executedAt: string,
  failedIds: readonly string[],
): string {
  const g = scores.gold;
  const s = scores.seeded;

  const criticalMissOk = s.critical_miss_rate === 0.0;
  const mustFindOk = s.must_find_recall >= 0.95;
  const hardGate = criticalMissOk && mustFindOk ? "PASS ✅" : "FAIL ❌";

  const repos = [...new Set(goldItems.map((item) => item.repository as string))].sort();
  const repoList = repos.map((r) => `- \`${r}\``).join("\n");

  const prLines = goldItems.map((item) => {
    const nf = ((item.human_findings as unknown[]) ?? []).length;
    const title = truncateTitle((item.title as string) ?? "", 50);
    return `| \`${item.id}\` | ${title} | ${nf} |`;
  });
  const prTable = prLines.join("\n");

  const goldTitleById: Record<string, string> = {};
  for (const item of goldItems) {
    goldTitleById[item.id as string] = (item.title as string) ?? "";
  }
  const seededBaseSourceById: Record<string, string> = {};
  for (const item of seededItems) {
    seededBaseSourceById[item.id as string] = (item.base_source as string) ?? "";
  }

  const failedIdSet = new Set(failedIds);
  const goldDetailItems = g.items.filter((item) => !failedIdSet.has(item.id as string));
  const seededDetailItems = s.items.filter((item) => !failedIdSet.has(item.id as string));

  const goldExcludedNote =
    goldDetailItems.length !== g.items.length
      ? `_評価失敗のため ${g.items.length - goldDetailItems.length} 件を除外（詳細は「失敗アイテム」を参照）_\n\n`
      : "";
  const seededExcludedNote =
    seededDetailItems.length !== s.items.length
      ? `_評価失敗のため ${s.items.length - seededDetailItems.length} 件を除外（詳細は「失敗アイテム」を参照）_\n\n`
      : "";

  const goldDetail =
    goldExcludedNote +
    (goldDetailItems.length > 0
      ? goldDetailItems
          .map((item) =>
            renderItemDetail(
              item,
              goldHeading(item.id as string, goldTitleById),
              "人間レビュー指摘",
            ),
          )
          .join("\n")
      : "_(該当PRなし)_\n");

  const seededDetail =
    seededExcludedNote +
    (seededDetailItems.length > 0
      ? seededDetailItems
          .map((item) =>
            renderItemDetail(
              item,
              seededHeading(
                item.id as string,
                seededBaseSourceById[item.id as string] ?? "",
                goldTitleById,
              ),
              "Must-Find",
            ),
          )
          .join("\n")
      : "_(該当アイテムなし)_\n");

  let failureSection = "";
  if (failedIds.length > 0) {
    const ids = failedIds.map((i) => `- \`${i}\``).join("\n");
    failureSection = `\n## 失敗アイテム\n\n以下のアイテムはエラーにより評価できませんでした（スコアは部分結果）:\n\n${ids}\n`;
  }

  return `# Agent 性能評価レポート: React + MUI

## 実行情報

| 項目 | 値 |
|---|---|
| 実行日時 | ${executedAt} |
| Commit hash | \`${commitHash}\` |
| モデル | \`${modelId}\` |

## 対象リポジトリ

${repoList}

## 評価対象 PR

| ID | タイトル | human findings |
|---|---|---|
${prTable}

## 評価スコア

### Gold set（実PRとの比較）

| 指標 | 値 | 目標 |
|---|---|---|
| Issue Recall | ${g.issue_recall.toFixed(3)} | ≥ 0.70 |
| Issue Precision | ${g.issue_precision.toFixed(3)} | ≥ 0.60 |
| Severity Agreement | ${g.severity_agreement.toFixed(3)} | ≥ 0.70 |
| Severity Exact Agreement | ${g.severity_exact_agreement.toFixed(3)} (n=${g.counts.severity_labeled_pairs}) | - |
| Severity Within-One Agreement | ${g.severity_within_one_agreement.toFixed(3)} (n=${g.counts.severity_labeled_pairs}) | - |
| Impact Exact Agreement | ${g.impact_exact_agreement.toFixed(3)} (n=${g.counts.impact_labeled_pairs}) | - |
| Priority Exact Agreement | ${g.priority_exact_agreement.toFixed(3)} (n=${g.counts.priority_labeled_pairs}) | - |
| Priority Within-One Agreement | ${g.priority_within_one_agreement.toFixed(3)} (n=${g.counts.priority_labeled_pairs}) | - |
| Gold findings 総数 | ${g.counts.gold_total} | - |
| マッチ数 | ${g.counts.gold_matched} | - |
| Agent predictions 数 | ${g.counts.pred_total_for_gold} | - |

### Seeded set（意図的バグ注入の検出率）

| 指標 | 値 | 目標 |
|---|---|---|
| Must-Find Recall | ${s.must_find_recall.toFixed(3)} | ≥ 0.95 |
| Critical Miss Rate | ${s.critical_miss_rate.toFixed(3)} | = 0 |
| Seeded issues 総数 | ${s.counts.seeded_total} | - |
| 検出数 | ${s.counts.seeded_detected} | - |
| Critical 総数 | ${s.counts.seeded_critical_total} | - |
| Critical 見逃し | ${s.counts.seeded_critical_missed} | - |

## Gold Set 詳細（PR ごとの人間レビュー指摘 vs Agent 指摘）

${goldDetail}
## Seeded Set 詳細（項目ごとの Must-Find vs Agent 指摘）

${seededDetail}
## Hard Gate 判定

**結果: ${hardGate}**

- Critical Miss Rate = 0: ${criticalMissOk ? "✅" : "❌"} (${s.critical_miss_rate.toFixed(3)})
- Must-Find Recall ≥ 0.95: ${mustFindOk ? "✅" : "❌"} (${s.must_find_recall.toFixed(3)})
${failureSection}`;
}

async function defaultScore(
  goldPath: string,
  seededPath: string,
  predPath: string,
): Promise<EvaluationScores> {
  const goldRows = await readJsonlRows(goldPath);
  const seededRows = await readJsonlRows(seededPath);
  const predRows = await readJsonlRows(predPath);
  const predById: Record<string, Row> = {};
  for (const row of predRows) {
    predById[row.id as string] = row;
  }
  const [gold, seeded] = await Promise.all([
    scoreGold(goldRows, predById),
    scoreSeeded(seededRows, predById),
  ]);
  return { gold, seeded } as unknown as EvaluationScores;
}

function formatExecutedAt(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

function formatTsStr(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export interface GenerateReportArgs {
  gold: string;
  seeded: string;
  pred: string;
  failedIdsFile?: string;
  allowMissingFailedIds: boolean;
}

export interface GenerateReportDeps {
  score?: (gold: string, seeded: string, pred: string) => Promise<EvaluationScores>;
  sendDiscordNotification?: typeof send_discord_notification;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  getCommitHash?: () => Promise<string>;
}

/**
 * `generateReport`'s exit-code contract: 5 (failed_ids sidecar missing), 4
 * (scoring failed), 1 (failed_ids present), 0 (clean success).
 */
export async function generateReport(
  args: GenerateReportArgs,
  deps: GenerateReportDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const modelId = env.CODE_REVIEW_MODEL_ID ?? "gpt-4o";
  const commitHash = await (deps.getCommitHash ?? defaultGetCommitHash)();
  // Single instant for both: the body's 実行日時 and the filename timestamp
  // used to disagree because they were two independent "now" reads in
  // different timezones (UTC vs local), which could show different dates
  // near a local midnight. UTC is used for the filename (not local time)
  // so both stay consistent with each other and with executedAt.
  const now = (deps.now ?? (() => new Date()))();
  const executedAt = formatExecutedAt(now);
  const tsStr = formatTsStr(now);

  const goldItems = await readJsonlRows(args.gold);
  const seededItems = await readJsonlRows(args.seeded);

  let failedIds: string[];
  try {
    failedIds = await loadFailedIds(args.pred, args.failedIdsFile, args.allowMissingFailedIds);
  } catch (error) {
    logger.error(errorMessage(error));
    return 5;
  }

  logger.info("--- Scoring ---");
  let scores: EvaluationScores;
  try {
    scores = await (deps.score ?? defaultScore)(args.gold, args.seeded, args.pred);
    logger.info(`Scores:\n${JSON.stringify(scores, null, 2)}`);
  } catch (error) {
    logger.error(`Scoring failed: ${errorMessage(error)}`);
    return 4;
  }

  const reportMd = buildReport(
    scores,
    goldItems,
    seededItems,
    commitHash,
    modelId,
    executedAt,
    failedIds,
  );
  const reportFilename = `report_${tsStr}-${commitHash}.md`;
  const reportPath = join(dirname(args.pred), reportFilename);
  await writeFile(reportPath, reportMd, "utf-8");
  logger.info(`Report written: ${reportPath}`);

  const sendNotification = deps.sendDiscordNotification ?? send_discord_notification;
  await sendNotification(
    env.DISCORD_WEBHOOK_URL,
    build_notification_payload(
      scores as unknown as DiscordEvaluationScores,
      failedIds,
      reportPath,
      commitHash,
      modelId,
      executedAt,
    ),
  );

  return failedIds.length > 0 ? 1 : 0;
}

interface ParsedOptions {
  gold: string;
  seeded: string;
  pred: string;
  failedIdsFile?: string;
  allowMissingFailedIds: boolean;
}

export async function run(argv: string[], deps: GenerateReportDeps = {}): Promise<number> {
  const program = new Command();
  program
    .name("generate-evaluation-report")
    .description("Score predictions and generate the Markdown report + Discord notification")
    .requiredOption("--gold <path>", "Gold JSONL path")
    .requiredOption("--seeded <path>", "Seeded JSONL path")
    .requiredOption("--pred <path>", "Predictions JSONL path")
    .option(
      "--failed-ids-file <path>",
      "Path to a JSON array of ids that failed evaluation. Defaults to the sidecar next to --pred (<pred-stem>.failed_ids.json).",
    )
    .option(
      "--allow-missing-failed-ids",
      "Treat a missing failed_ids sidecar as zero failures instead of a fatal error.",
      false,
    )
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
  return generateReport(
    {
      gold: options.gold,
      seeded: options.seeded,
      pred: options.pred,
      failedIdsFile: options.failedIdsFile,
      allowMissingFailedIds: options.allowMissingFailedIds,
    },
    deps,
  );
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
