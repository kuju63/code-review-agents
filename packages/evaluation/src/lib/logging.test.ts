import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("evaluation logging", () => {
  it("writes timestamped level and logger name to stderr", async () => {
    const { getLogger, setupLogging } = await import("./logging.js");
    const write = vi.fn<(chunk: string) => boolean>(() => true);
    setupLogging("info", { stream: { write }, now: () => new Date("2026-08-15T12:34:56.000Z") });

    getLogger("scorer").info("scored 3 items");

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("2026-08-15T12:34:56.000Z INFO scorer: scored 3 items\n");
  });

  it("applies the configured level", async () => {
    const { getLogger, setupLogging } = await import("./logging.js");
    const write = vi.fn<(chunk: string) => boolean>(() => true);
    setupLogging("warn", { stream: { write } });
    const logger = getLogger("builder");

    logger.debug("debug");
    logger.info("info");
    logger.warn("warning");
    logger.error("error");

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("WARN builder: warning"),
      expect.stringContaining("ERROR builder: error"),
    ]);
  });

  it("does not reconfigure or duplicate output when setup is called twice", async () => {
    const { getLogger, setupLogging } = await import("./logging.js");
    const firstWrite = vi.fn<(chunk: string) => boolean>(() => true);
    const secondWrite = vi.fn<(chunk: string) => boolean>(() => true);
    setupLogging("info", { stream: { write: firstWrite } });
    setupLogging("debug", { stream: { write: secondWrite } });

    getLogger("evaluation").info("once");

    expect(firstWrite).toHaveBeenCalledOnce();
    expect(secondWrite).not.toHaveBeenCalled();
  });
});
