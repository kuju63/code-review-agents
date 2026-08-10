import { describe, expect, it } from "vitest";
import { toolchainVersion } from "./index.js";

describe("evaluation toolchain smoke test", () => {
  it("exposes a version string", () => {
    expect(toolchainVersion).toBe("0.0.0");
  });
});
