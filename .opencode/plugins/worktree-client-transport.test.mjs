import assert from "node:assert/strict";
import test from "node:test";

// Requires `node --experimental-test-module-mocks` (mocks @opencode-ai/sdk/v2
// via t.mock.module below).
//
// Kept in its own file: see worktree-error-surfacing.test.mjs for why a
// module that dynamically imports worktree.js needs process isolation from
// other files mocking the same @opencode-ai/sdk/v2 module. The paired
// fallback-path scenario lives in worktree-client-transport-fallback.test.mjs
// for the same reason -- a second t.mock.module + import("./worktree.js") in
// this same file/process would silently reuse the module cached by the first.

test("WorktreePlugin borrows fetch+baseUrl from context.client's internal transport instead of building its own", async (t) => {
  let capturedArgs;
  t.mock.module("@opencode-ai/sdk/v2", {
    exports: {
      createOpencodeClient: (args) => {
        capturedArgs = args;
        return {
          tui: { showToast: async () => {} },
          experimental: { workspace: { list: async () => ({ data: [] }) } },
        };
      },
    },
  });

  const { WorktreePlugin } = await import("./worktree.js");

  // opencode's plugin loader (packages/opencode/src/plugin/index.ts) builds
  // context.client from @opencode-ai/sdk once, and -- when Server.url isn't
  // set (the normal case for TUI/attach sessions, which never open a
  // listening TCP socket) -- pairs it with a custom `fetch` that calls the
  // server's Hono app directly in-process rather than over the network.
  // context.serverUrl carries no such fetch override, so building a client
  // from it alone always tries (and fails) to dial out to the unreachable
  // "http://localhost:4096" fallback in that mode. Model the borrowed
  // transport here via a sentinel fetch/baseUrl on context.client's internal
  // client, standing in for what opencode's real client exposes.
  const sentinelFetch = async () => new Response("{}");
  const plugin = await WorktreePlugin({
    directory: "/tmp/example-project",
    $: () => {
      throw new Error("$ should not be invoked");
    },
    serverUrl: new URL("http://localhost:4096"),
    experimental_workspace: { register: () => {} },
    client: {
      _client: {
        getConfig: () => ({
          baseUrl: "http://sentinel.invalid",
          fetch: sentinelFetch,
          headers: new Headers({ authorization: "Bearer secret" }),
        }),
      },
    },
  });

  await assert.rejects(
    plugin.tool.worktree_remove.execute({ branch: "feature/test" }, { sessionID: "ses_test" }),
  );

  assert.equal(capturedArgs.baseUrl, "http://sentinel.invalid");
  assert.equal(capturedArgs.fetch, sentinelFetch);
  // Headers are deliberately not borrowed (see resolveClientOptions in
  // worktree.js for why forwarding a Headers instance through a plain-object
  // spread would silently drop it anyway).
  assert.equal(capturedArgs.headers, undefined);
});
