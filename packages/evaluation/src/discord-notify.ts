/**
 * Discord Webhook notification for evaluation pipeline completion.
 *
 * Fires once per evaluation run, right after the report is written.
 * Notification is opt-in (skipped when the webhook URL is unset) and
 * best-effort: any failure is logged as a warning and never propagates, so
 * a broken webhook can't fail an evaluation run that took a long time to
 * produce its result.
 */
import { basename } from "node:path";
import { getLogger } from "./lib/logging.js";

const logger = getLogger("discord_notify");

export const _COLOR_PASS = 0x2ecc71;
export const _COLOR_FAIL = 0xe74c3c;

interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface DiscordNotificationPayload {
  embeds: [
    {
      title: string;
      description: string;
      color: number;
      fields: EmbedField[];
      timestamp: string;
    },
  ];
}

type ScoreCounts = Record<string, unknown>;

interface GoldScores {
  issue_recall: number;
  issue_precision: number;
  severity_agreement: number;
  counts: ScoreCounts;
}

interface SeededScores {
  must_find_recall: number;
  critical_miss_rate: number;
  counts: ScoreCounts;
}

export interface EvaluationScores {
  gold: GoldScores;
  seeded: SeededScores;
}

export function build_notification_payload(
  scores: EvaluationScores,
  failed_ids: readonly string[],
  report_path: string,
  commit_hash: string,
  model_id: string,
  executed_at: string,
): DiscordNotificationPayload {
  const g = scores.gold;
  const s = scores.seeded;

  const criticalMissOk = s.critical_miss_rate === 0.0;
  const mustFindOk = s.must_find_recall >= 0.95;
  const hardGatePass = criticalMissOk && mustFindOk;

  const fields: EmbedField[] = [
    { name: "Hard Gate", value: hardGatePass ? "PASS ✅" : "FAIL ❌", inline: true },
    { name: "Issue Recall", value: g.issue_recall.toFixed(3), inline: true },
    { name: "Issue Precision", value: g.issue_precision.toFixed(3), inline: true },
    { name: "Must-Find Recall", value: s.must_find_recall.toFixed(3), inline: true },
    { name: "Critical Miss Rate", value: s.critical_miss_rate.toFixed(3), inline: true },
    { name: "失敗アイテム数", value: String(failed_ids.length), inline: true },
    { name: "Commit", value: `\`${commit_hash}\``, inline: true },
    { name: "Model", value: `\`${model_id}\``, inline: true },
  ];

  return {
    embeds: [
      {
        title: "評価パイプライン完了",
        description: `Report: \`${basename(report_path)}\``,
        color: hardGatePass ? _COLOR_PASS : _COLOR_FAIL,
        fields,
        timestamp: executed_at,
      },
    ],
  };
}

export interface SendDiscordNotificationOptions {
  fetch?: typeof globalThis.fetch;
}

/**
 * POST *payload* to the Discord webhook. No-ops when *webhookUrl* is unset
 * or empty.
 *
 * Never throws: failures are logged as warnings so they can't fail an
 * evaluation run whose actual result already succeeded or failed on its own
 * merits.
 */
export async function send_discord_notification(
  webhook_url: string | null | undefined,
  payload: DiscordNotificationPayload,
  options: SendDiscordNotificationOptions = {},
): Promise<void> {
  if (!webhook_url) {
    return;
  }
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`bad status for url '${webhook_url}': ${response.status}`);
    }
  } catch (error) {
    // Node fetch/Error messages (and any embedded URL) can carry the
    // webhook's auth token in its path -- redact it before it ever lands
    // in logs.
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.replaceAll(webhook_url, "<redacted webhook url>");
    logger.warn(`Discord notification failed: ${message}`);
  }
}
