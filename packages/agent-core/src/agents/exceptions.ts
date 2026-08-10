import type { StopReason } from "@strands-agents/sdk";

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
