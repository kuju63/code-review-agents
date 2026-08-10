import {
  ContextWindowOverflowError,
  MaxTokensError,
  Message,
  ModelError,
  ModelThrottledError,
  StructuredOutputError,
} from "@strands-agents/sdk";
import { describe, expect, it } from "vitest";
import { GithubMcpConnectionError } from "../tools/github-mcp.js";
import { isInfraError, StructuredOutputMissingError } from "./exceptions.js";

describe("isInfraError", () => {
  it("treats a bare ModelError as infra", () => {
    expect(isInfraError(new ModelError("connection lost"))).toBe(true);
  });

  it("treats GithubMcpConnectionError as infra", () => {
    expect(isInfraError(new GithubMcpConnectionError("retries exhausted"))).toBe(true);
  });

  it("treats ContextWindowOverflowError as business-level, not infra", () => {
    expect(isInfraError(new ContextWindowOverflowError("too much context"))).toBe(false);
  });

  it("treats MaxTokensError as business-level, not infra", () => {
    const partialMessage = new Message({ role: "assistant", content: [] });
    expect(isInfraError(new MaxTokensError("hit max tokens", partialMessage))).toBe(false);
  });

  it("treats ModelThrottledError as business-level, not infra", () => {
    expect(isInfraError(new ModelThrottledError("rate limited"))).toBe(false);
  });

  it("treats StructuredOutputError (SDK) as business-level, not infra", () => {
    expect(isInfraError(new StructuredOutputError("bad structured output"))).toBe(false);
  });

  it("treats StructuredOutputMissingError (this module) as business-level, not infra", () => {
    expect(isInfraError(new StructuredOutputMissingError("Reviewer", "limitTurns"))).toBe(false);
  });

  it("treats an unrelated Error as business-level, not infra", () => {
    expect(isInfraError(new Error("boom"))).toBe(false);
  });

  it("treats a non-Error value as business-level, not infra", () => {
    expect(isInfraError("plain string")).toBe(false);
  });
});

describe("StructuredOutputMissingError", () => {
  it("is an Error subclass", () => {
    const error = new StructuredOutputMissingError("Reviewer 'react-technical'", "limitTurns");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("StructuredOutputMissingError");
  });

  it("includes the agent label and stop reason in the message", () => {
    const error = new StructuredOutputMissingError("Reviewer 'react-technical'", "limitTurns");
    expect(error.message).toContain("Reviewer 'react-technical'");
    expect(error.message).toContain("limitTurns");
  });

  it("renders the stop reason as undefined when unavailable", () => {
    const error = new StructuredOutputMissingError("Lead Engineer", undefined);
    expect(error.message).toContain("undefined");
  });
});
