import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns the result on the first successful attempt without sleeping", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries after a failure and returns the result once it succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("rethrows the last error once every attempt is exhausted", async () => {
    const error = new Error("always fails");
    const fn = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("rethrows immediately without retrying when shouldRetry returns false", async () => {
    const error = new Error("not retryable");
    const fn = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep, shouldRetry })).rejects.toBe(
      error,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(shouldRetry).toHaveBeenCalledWith(error);
  });

  it("retries every error when shouldRetry is omitted", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withRetry(fn, { attempts: 2, baseDelayMs: 100, sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("computes an exponentially growing jittered delay bounded by baseDelayMs * 2^attemptIndex", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const random = vi.fn().mockReturnValue(1);

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep, random })).rejects.toThrow(
      "boom",
    );

    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("computes zero delay when random returns 0", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const random = vi.fn().mockReturnValue(0);

    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 100, sleep, random })).rejects.toThrow(
      "boom",
    );

    expect(sleep).toHaveBeenNthCalledWith(1, 0);
  });
});
