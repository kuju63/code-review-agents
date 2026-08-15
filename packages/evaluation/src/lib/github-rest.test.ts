import { describe, expect, it, vi } from "vitest";
import {
  apiGet,
  fetchPrFiles,
  GitHubHttpError,
  GitHubRateLimitError,
  isAllowedUrl,
} from "./github-rest.js";

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("GitHub URL allowlist", () => {
  it.each([
    ["https://api.github.com/repos/x/y", true],
    ["https://api.github.com:443/repos/x/y", true],
    ["http://api.github.com/repos/x/y", false],
    ["https://evil.example.com/repos/x/y", false],
    ["https://notapi.github.com/repos/x/y", false],
    ["https://api.github.com:8443/repos/x/y", false],
    ["not a URL", false],
  ])("classifies %s", (url, expected) => {
    expect(isAllowedUrl(url)).toBe(expected);
  });

  it("rejects a disallowed initial URL before sending credentials", async () => {
    const fetch = vi.fn();
    await expect(apiGet("https://evil.example.com/x", "secret", { fetch })).rejects.toThrow(
      /api\.github\.com/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GitHub redirects", () => {
  it("follows a same-host HTTPS redirect manually", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/b" } }))
      .mockResolvedValueOnce(response({ ok: true }));

    await expect(apiGet("https://api.github.com/a", "secret", { fetch })).resolves.toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
  });

  it.each([
    "https://evil.example.com/a",
    "http://api.github.com/a",
    "https://api.github.com:8443/a",
  ])("refuses redirect target %s without sending the token", async (location) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location } }));

    await expect(apiGet("https://api.github.com/a", "secret", { fetch })).rejects.toThrow(
      /redirect/,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds same-host redirect chains", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "/again" } }));

    await expect(
      apiGet("https://api.github.com/a", "secret", { fetch, maxRedirects: 2 }),
    ).rejects.toThrow(/redirect/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("GitHub retries", () => {
  it.each([
    [503, {}],
    [429, {}],
    [403, { "x-ratelimit-remaining": "0" }],
  ])("retries status %s then succeeds", async (status, headers) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ message: "retry" }, status, headers))
      .mockResolvedValueOnce(response({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(apiGet("https://api.github.com/x", "token", { fetch, sleep })).resolves.toEqual({
      ok: true,
    });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry a non-rate-limited 403", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ message: "forbidden" }, 403));
    const sleep = vi.fn();

    await expect(
      apiGet("https://api.github.com/x", "token", { fetch, sleep }),
    ).rejects.toBeInstanceOf(GitHubHttpError);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry a 404", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ message: "missing" }, 404));

    await expect(apiGet("https://api.github.com/x", "token", { fetch })).rejects.toMatchObject({
      status: 404,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports rate-limit reset after exhausting attempts", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ message: "limited" }, 403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1234567890",
      }),
    );

    await expect(
      apiGet("https://api.github.com/x", "token", {
        fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
        maxAttempts: 2,
      }),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
    await expect(
      apiGet("https://api.github.com/x", "token", {
        fetch,
        sleep: vi.fn().mockResolvedValue(undefined),
        maxAttempts: 1,
      }),
    ).rejects.toThrow(/1234567890/);
  });

  it("retries network failures and propagates the last one", async () => {
    const error = new TypeError("network down");
    const fetch = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      apiGet("https://api.github.com/x", "token", { fetch, sleep, maxAttempts: 3 }),
    ).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([1000, 2000]);
  });
});

describe("fetchPrFiles", () => {
  it("maps patched files, skips missing patches, and paginates", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `file${index}.ts`,
      patch: `+patch${index}`,
    }));
    firstPage[1] = { filename: "binary.png", patch: "" };
    const apiGetMock = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ filename: "file100.ts", patch: "+patch100" }]);

    const result = await fetchPrFiles("kuju63", "vue-seeded", 8, "token", {
      apiGet: apiGetMock,
    });

    expect(result).toHaveLength(100);
    expect(result.at(-1)).toEqual({ path: "file100.ts", patch: "+patch100" });
    expect(apiGetMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/kuju63/vue-seeded/pulls/8/files?per_page=100&page=1",
      "https://api.github.com/repos/kuju63/vue-seeded/pulls/8/files?per_page=100&page=2",
    ]);
  });

  it("stops after an empty page", async () => {
    const apiGetMock = vi.fn().mockResolvedValue([]);

    await expect(
      fetchPrFiles("owner", "repo", 1, "token", { apiGet: apiGetMock }),
    ).resolves.toEqual([]);
    expect(apiGetMock).toHaveBeenCalledOnce();
  });

  it("fails closed on a non-array response", async () => {
    await expect(
      fetchPrFiles("owner", "repo", 1, "token", {
        apiGet: vi.fn().mockResolvedValue({ message: "unexpected" }),
      }),
    ).rejects.toThrow(/array/);
  });

  it("bounds pagination", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `file${index}.ts`,
      patch: "+patch",
    }));
    const apiGetMock = vi.fn().mockResolvedValue(fullPage);

    await expect(
      fetchPrFiles("owner", "repo", 1, "token", { apiGet: apiGetMock, maxPages: 2 }),
    ).rejects.toThrow(/pagination/);
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });
});
