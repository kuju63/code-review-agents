import { describe, expect, it, vi } from "vitest";
import { installUndiciIdleErrorGuard, isUndiciIdleTimeoutError } from "./process-guards.js";

function idleTimeoutError(): Error {
  return Object.assign(new Error("socket idle timeout"), {
    name: "InformationalError",
    code: "UND_ERR_INFO",
  });
}

function setup() {
  const handlers: Array<(error: Error, origin: string) => void> = [];
  const target = {
    on: vi.fn((_event: "uncaughtException", handler: (error: Error, origin: string) => void) => {
      handlers.push(handler);
    }),
  };
  const exit = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  installUndiciIdleErrorGuard({ target, exit, logger: { warn, error } });
  return { handlers, target, exit, warn, error };
}

describe("isUndiciIdleTimeoutError", () => {
  it("matches UND_ERR_INFO with a socket idle timeout message", () => {
    expect(isUndiciIdleTimeoutError(idleTimeoutError())).toBe(true);
  });

  it("rejects the same message without the undici code", () => {
    expect(isUndiciIdleTimeoutError(new Error("socket idle timeout"))).toBe(false);
  });

  it("rejects UND_ERR_INFO with a different message", () => {
    const other = Object.assign(new Error("something else"), { code: "UND_ERR_INFO" });
    expect(isUndiciIdleTimeoutError(other)).toBe(false);
  });

  it("rejects non-Error values", () => {
    expect(isUndiciIdleTimeoutError("socket idle timeout")).toBe(false);
    expect(isUndiciIdleTimeoutError(undefined)).toBe(false);
  });
});

describe("installUndiciIdleErrorGuard", () => {
  it("registers exactly one uncaughtException handler", () => {
    const { target } = setup();
    expect(target.on).toHaveBeenCalledTimes(1);
    expect(target.on).toHaveBeenCalledWith("uncaughtException", expect.any(Function));
  });

  it("keeps the process alive and logs code and message for an idle timeout", () => {
    const { handlers, exit, warn } = setup();

    handlers[0]?.(idleTimeoutError(), "uncaughtException");

    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("UND_ERR_INFO");
    expect(String(warn.mock.calls[0]?.[0])).toContain("socket idle timeout");
  });

  it("logs and exits with code 1 for any other uncaught exception", () => {
    const { handlers, exit, error } = setup();

    handlers[0]?.(new Error("boom"), "uncaughtException");

    expect(error).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still exits for an idle timeout that arrives as an unhandled rejection", () => {
    const { handlers, exit, warn, error } = setup();

    handlers[0]?.(idleTimeoutError(), "unhandledRejection");

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
