/**
 * Process-level guards for a2a-server. See
 * docs/plan/a2a-server-undici-idle-error-guard-spec.md (Issue #296).
 */

type GuardLogger = Pick<Console, "warn" | "error">;

type UncaughtExceptionTarget = {
  on(event: "uncaughtException", handler: (error: Error) => void): unknown;
};

export type UndiciIdleErrorGuardOptions = {
  target?: UncaughtExceptionTarget;
  exit?: (code: number) => void;
  logger?: GuardLogger;
};

/**
 * True only for undici's HTTP/2 session idle timeout (`InformationalError`,
 * `code: UND_ERR_INFO`, "socket idle timeout"). Both the code and the message
 * are required so unrelated UND_ERR_INFO errors stay fatal.
 */
export function isUndiciIdleTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    (error as Error & { code?: unknown }).code === "UND_ERR_INFO" &&
    error.message.includes("socket idle timeout")
  );
}

/**
 * Keeps the server alive when an idle HTTP/2 session emits an unhandled
 * `error` (Issue #296). This treats the symptom, not the root cause. Every
 * other uncaught exception is logged and still terminates the process, so
 * registering the handler does not weaken Node's default crash behavior.
 */
export function installUndiciIdleErrorGuard({
  target = process,
  exit = (code) => process.exit(code),
  logger = console,
}: UndiciIdleErrorGuardOptions = {}): void {
  target.on("uncaughtException", (error) => {
    if (isUndiciIdleTimeoutError(error)) {
      const code = (error as Error & { code?: unknown }).code;
      logger.warn(`Ignored undici idle timeout error (code=${String(code)}): ${error.message}`);
      return;
    }
    logger.error("Uncaught exception, exiting:", error);
    exit(1);
  });
}
