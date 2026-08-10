import type { McpClient } from "@strands-agents/sdk";

/**
 * Reference-counting wrapper around a single {@link McpClient} shared by
 * several concurrent consumers.
 *
 * `@strands-agents/sdk`'s `McpClient` has no `addConsumer`/`removeConsumer`
 * equivalent (unlike the Python SDK's `MCPClient`), so this class reproduces
 * that behavior: the wrapped client is disconnected once the last registered
 * consumer is removed, and never before. Each `addConsumer`/`removeConsumer`
 * pair runs to completion synchronously up to the decision to disconnect (no
 * `await` in between), so concurrent callers can never observe the count
 * dropping below zero or trigger more than one `disconnect()` call.
 */
export class SharedMcpClient {
  private readonly consumers = new Set<object>();

  constructor(private readonly client: McpClient) {}

  /** The wrapped `McpClient`, to be handed to `Agent({ tools: [...] })`. */
  get mcpClient(): McpClient {
    return this.client;
  }

  /** Registers `key` as a consumer, keeping the shared connection alive. */
  addConsumer(key: object): void {
    this.consumers.add(key);
  }

  /**
   * Unregisters `key`. Disconnects the wrapped client once no consumer
   * remains. Removing a key that was never added (or already removed) is a
   * no-op.
   */
  async removeConsumer(key: object): Promise<void> {
    const wasRegistered = this.consumers.delete(key);
    if (wasRegistered && this.consumers.size === 0) {
      await this.client.disconnect();
    }
  }
}
