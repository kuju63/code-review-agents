import { McpClient } from "@strands-agents/sdk";
import { withRetry } from "./retry.js";

export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/read-only";

/**
 * Raised when the GitHub MCP connection could not be established after
 * exhausting all configured retry attempts. Distinguishable from a business
 * failure so callers (the review orchestrator, slice C) can treat it as an
 * infrastructure failure rather than an isolated per-reviewer error -- see
 * typescript-agents-tools-migration-spec.md section 2.8.
 */
export class GithubMcpConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GithubMcpConnectionError";
  }
}

export interface CreateGithubMcpClientOptions {
  /** Maximum number of connect attempts (including the first). */
  retryAttempts?: number;
  /** Base delay in seconds for the exponential backoff between attempts. */
  retryBackoffSeconds?: number;
}

/**
 * Creates an McpClient connected to the GitHub MCP endpoint.
 *
 * `connect()` is wrapped in place with exponential backoff+jitter retry, so
 * every caller -- a direct `connect()` call, `Agent.initialize()`'s
 * `listTools()` path, and `callTool()` -- gets the retry for free, since all
 * three call `this.connect()` internally.
 */
export function createGithubMcpClient(
  token: string,
  url: string = GITHUB_MCP_URL,
  { retryAttempts = 3, retryBackoffSeconds = 1 }: CreateGithubMcpClientOptions = {},
): McpClient {
  const client = new McpClient({
    url,
    headers: { Authorization: `Bearer ${token}` },
  });

  const originalConnect = client.connect.bind(client);
  client.connect = async (reconnect?: boolean) => {
    try {
      await withRetry(() => originalConnect(reconnect), {
        attempts: retryAttempts,
        baseDelayMs: retryBackoffSeconds * 1000,
      });
    } catch (error) {
      throw new GithubMcpConnectionError(
        `Failed to connect to the GitHub MCP endpoint after ${retryAttempts} attempt(s)`,
        { cause: error },
      );
    }
  };

  return client;
}
