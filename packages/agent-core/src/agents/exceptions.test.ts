import { describe, expect, it } from "vitest";
import { StructuredOutputMissingError } from "./exceptions.js";

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
