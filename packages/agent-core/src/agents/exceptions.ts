import {
  ContextWindowOverflowError,
  MaxTokensError,
  ModelError,
  ModelThrottledError,
  type StopReason,
} from "@strands-agents/sdk";
import { GithubMcpConnectionError } from "../tools/github-mcp.js";

/**
 * Raised when an LLM agent call ends without a structured output result.
 *
 * The SDK does not throw when a turn/token limit is exhausted: `Agent.invoke()`
 * resolves with an `AgentResult` whose `stopReason` is set (e.g. `"limitTurns"`)
 * and `structuredOutput` is `undefined`. Callers must check for this explicitly
 * rather than assuming `result.structuredOutput` is always populated.
 */
export class StructuredOutputMissingError extends Error {
  constructor(agentLabel: string, stopReason: StopReason | undefined) {
    super(
      `${agentLabel} completed without producing structured output ` +
        `(stopReason=${String(stopReason)}). The model likely could not satisfy ` +
        "the output schema within the configured turn limit.",
    );
    this.name = "StructuredOutputMissingError";
  }
}

/**
 * Classifies an error as an infrastructure failure (model connection loss,
 * GitHub MCP client init failure) rather than a business/content-level error.
 *
 * Mirrors Python's `INFRA_EXCEPTIONS` tuple: the review orchestrator (slice C)
 * re-throws infra failures instead of degrading them to an isolated
 * `ReviewError`, so the whole batch aborts rather than silently completing
 * with partial data. `ContextWindowOverflowError`/`MaxTokensError`/
 * `ModelThrottledError` are excluded even though they extend `ModelError`:
 * they are content/rate-limit issues scoped to one reviewer's call, not a
 * system-wide connectivity problem, matching how Python's `INFRA_EXCEPTIONS`
 * never included content-shape failures either. See
 * typescript-agents-tools-migration-spec.md section 5.2.
 */
export function isInfraError(error: unknown): boolean {
  if (error instanceof GithubMcpConnectionError) {
    return true;
  }
  if (
    error instanceof ContextWindowOverflowError ||
    error instanceof MaxTokensError ||
    error instanceof ModelThrottledError
  ) {
    return false;
  }
  return error instanceof ModelError;
}
