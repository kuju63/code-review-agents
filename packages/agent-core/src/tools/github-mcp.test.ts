import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConnect, mockMcpClientCtor } = vi.hoisted(() => {
  const mockConnect = vi.fn();
  const mockMcpClientCtor = vi.fn().mockImplementation((config: unknown) => ({
    __config: config,
    connect: mockConnect,
  }));
  return { mockConnect, mockMcpClientCtor };
});

vi.mock("@strands-agents/sdk", () => ({
  McpClient: mockMcpClientCtor,
}));

const { createGithubMcpClient, GITHUB_MCP_URL, GithubMcpConnectionError } = await import(
  "./github-mcp.js"
);

describe("createGithubMcpClient", () => {
  beforeEach(() => {
    mockMcpClientCtor.mockClear();
    mockConnect.mockReset();
    mockConnect.mockResolvedValue(undefined);
  });

  it("constructs an McpClient pointed at the default GitHub MCP URL with a bearer header", () => {
    createGithubMcpClient("gh-token");

    expect(mockMcpClientCtor).toHaveBeenCalledWith({
      url: GITHUB_MCP_URL,
      headers: { Authorization: "Bearer gh-token" },
    });
  });

  it("honors an explicit url", () => {
    createGithubMcpClient("gh-token", "https://example.test/mcp");

    expect(mockMcpClientCtor).toHaveBeenCalledWith({
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer gh-token" },
    });
  });

  it("does not retry when connect succeeds on the first attempt", async () => {
    const client = createGithubMcpClient("gh-token");

    await client.connect();

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("retries a failed connect and eventually resolves", async () => {
    const client = createGithubMcpClient("gh-token", GITHUB_MCP_URL, {
      retryAttempts: 3,
      retryBackoffSeconds: 0.001,
    });
    mockConnect.mockRejectedValueOnce(new Error("connection refused"));
    mockConnect.mockResolvedValueOnce(undefined);

    await client.connect();

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("wraps the final failure as a GithubMcpConnectionError after exhausting retries", async () => {
    const client = createGithubMcpClient("gh-token", GITHUB_MCP_URL, {
      retryAttempts: 2,
      retryBackoffSeconds: 0.001,
    });
    const lastError = new Error("connection refused");
    mockConnect.mockRejectedValue(lastError);

    await expect(client.connect()).rejects.toBeInstanceOf(GithubMcpConnectionError);
    expect(mockConnect).toHaveBeenCalledTimes(2);

    mockConnect.mockClear();
    mockConnect.mockRejectedValue(lastError);
    await expect(client.connect()).rejects.toMatchObject({ cause: lastError });
  });
});
