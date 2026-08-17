import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _COLOR_FAIL,
  _COLOR_PASS,
  build_notification_payload,
  type EvaluationScores,
} from "./discord-notify.js";

beforeEach(() => {
  vi.resetModules();
});

function scores(criticalMissRate: number, mustFindRecall: number): EvaluationScores {
  return {
    gold: {
      issue_recall: 0.8,
      issue_precision: 0.7,
      severity_agreement: 0.75,
      counts: {},
    },
    seeded: {
      must_find_recall: mustFindRecall,
      critical_miss_rate: criticalMissRate,
      counts: {},
    },
  };
}

function fakeResponse(ok: boolean, status = 200): Response {
  return { ok, status } as Response;
}

describe("build_notification_payload", () => {
  it("uses green color and PASS label when the hard gate passes", () => {
    const payload = build_notification_payload(
      scores(0.0, 1.0),
      [],
      "evaluation/data/report_20260705-000000-abcdef.md",
      "abcdef",
      "gpt-4o",
      "2026-07-05T00:00:00Z",
    );

    const embed = payload.embeds[0];
    expect(embed.color).toBe(_COLOR_PASS);
    const gateField = embed.fields.find((f) => f.name === "Hard Gate");
    expect(gateField?.value).toContain("PASS");
    expect(embed.description).toContain("report_20260705-000000-abcdef.md");
  });

  it("uses red color and FAIL label when the hard gate fails", () => {
    const payload = build_notification_payload(
      scores(0.2, 0.5),
      ["seeded-1", "seeded-2"],
      "evaluation/data/report_20260705-000000-abcdef.md",
      "abcdef",
      "gpt-4o",
      "2026-07-05T00:00:00Z",
    );

    const embed = payload.embeds[0];
    expect(embed.color).toBe(_COLOR_FAIL);
    const gateField = embed.fields.find((f) => f.name === "Hard Gate");
    expect(gateField?.value).toContain("FAIL");
    const failedField = embed.fields.find((f) => f.name === "失敗アイテム数");
    expect(failedField?.value).toBe("2");
  });

  it("fails the gate when must-find recall alone is below threshold", () => {
    const payload = build_notification_payload(
      scores(0.0, 0.94),
      [],
      "report.md",
      "x",
      "m",
      "2026-07-05T00:00:00Z",
    );

    expect(payload.embeds[0].color).toBe(_COLOR_FAIL);
  });
});

async function freshModule() {
  const write = vi.fn<(chunk: string) => boolean>(() => true);
  const { setupLogging } = await import("./lib/logging.js");
  setupLogging("info", { stream: { write } });
  const mod = await import("./discord-notify.js");
  return { ...mod, write };
}

describe("send_discord_notification", () => {
  it("no-ops when the webhook URL is undefined", async () => {
    const { send_discord_notification } = await freshModule();
    const fetch = vi.fn();
    await send_discord_notification(undefined, { embeds: [] } as never, { fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("no-ops when the webhook URL is an empty string", async () => {
    const { send_discord_notification } = await freshModule();
    const fetch = vi.fn();
    await send_discord_notification("", { embeds: [] } as never, { fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the payload to the webhook URL", async () => {
    const { send_discord_notification } = await freshModule();
    const fetch = vi.fn().mockResolvedValue(fakeResponse(true));
    const payload = { embeds: [{ title: "x" }] } as never;

    await send_discord_notification("https://discord.example/webhook", payload, { fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.example/webhook");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("logs and does not throw on a network error", async () => {
    const { send_discord_notification } = await freshModule();
    const fetch = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      send_discord_notification("https://discord.example/webhook", { embeds: [] } as never, {
        fetch,
      }),
    ).resolves.toBeUndefined();
  });

  it("logs a message with no webhook URL/token and does not throw on an HTTP error status", async () => {
    const webhookUrl = "https://discord.example/api/webhooks/123/super-secret-token";
    const { send_discord_notification, write } = await freshModule();
    const fetch = vi.fn().mockResolvedValue(fakeResponse(false, 400));

    await send_discord_notification(webhookUrl, { embeds: [] } as never, { fetch });

    expect(write).toHaveBeenCalled();
    const messages = write.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("Discord notification failed"))).toBe(true);
    expect(messages.some((m) => m.includes("super-secret-token"))).toBe(false);
    expect(messages.some((m) => m.includes(webhookUrl))).toBe(false);
  });

  it("still redacts a webhook URL that a fetch-thrown error embeds verbatim", async () => {
    const webhookUrl = "https://discord.example/api/webhooks/123/super-secret-token";
    const { send_discord_notification, write } = await freshModule();
    const fetch = vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${webhookUrl}`));

    await send_discord_notification(webhookUrl, { embeds: [] } as never, { fetch });

    const messages = write.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("super-secret-token"))).toBe(false);
    expect(messages.some((m) => m.includes("<redacted webhook url>"))).toBe(true);
  });
});
