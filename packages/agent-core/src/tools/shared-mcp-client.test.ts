import type { McpClient } from "@strands-agents/sdk";
import { describe, expect, it, vi } from "vitest";
import { SharedMcpClient } from "./shared-mcp-client.js";

function fakeMcpClient(): McpClient {
  return { disconnect: vi.fn().mockResolvedValue(undefined) } as unknown as McpClient;
}

describe("SharedMcpClient", () => {
  it("exposes the wrapped McpClient instance", () => {
    const inner = fakeMcpClient();
    const shared = new SharedMcpClient(inner);

    expect(shared.mcpClient).toBe(inner);
  });

  it("does not disconnect while at least one consumer remains registered", async () => {
    const inner = fakeMcpClient();
    const shared = new SharedMcpClient(inner);
    const a = {};
    const b = {};

    shared.addConsumer(a);
    shared.addConsumer(b);
    await shared.removeConsumer(a);

    expect(inner.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects once the last consumer is removed", async () => {
    const inner = fakeMcpClient();
    const shared = new SharedMcpClient(inner);
    const a = {};
    const b = {};

    shared.addConsumer(a);
    shared.addConsumer(b);
    await shared.removeConsumer(a);
    await shared.removeConsumer(b);

    expect(inner.disconnect).toHaveBeenCalledOnce();
  });

  it("does not disconnect twice when removeConsumer is called again after reaching zero", async () => {
    const inner = fakeMcpClient();
    const shared = new SharedMcpClient(inner);
    const a = {};

    shared.addConsumer(a);
    await shared.removeConsumer(a);
    await shared.removeConsumer(a);

    expect(inner.disconnect).toHaveBeenCalledOnce();
  });

  it("treats removing a never-registered consumer as a no-op", async () => {
    const inner = fakeMcpClient();
    const shared = new SharedMcpClient(inner);
    const a = {};
    const stranger = {};

    shared.addConsumer(a);
    await shared.removeConsumer(stranger);

    expect(inner.disconnect).not.toHaveBeenCalled();
  });

  it("treats the same consumer added twice as a single reference", async () => {
    const inner = fakeMcpClient();
    const shared = new SharedMcpClient(inner);
    const a = {};

    shared.addConsumer(a);
    shared.addConsumer(a);
    await shared.removeConsumer(a);

    expect(inner.disconnect).toHaveBeenCalledOnce();
  });
});
