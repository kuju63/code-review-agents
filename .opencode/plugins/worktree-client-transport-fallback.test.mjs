import assert from "node:assert/strict";
import test from "node:test";

// Requires `node --experimental-test-module-mocks` (mocks @opencode-ai/sdk/v2
// via t.mock.module below).
//
// Kept in its own file, separate from worktree-client-transport.test.mjs: see
// that file for why the two scenarios can't share a process.

test("WorktreePlugin falls back to context.serverUrl with the default network fetch when context.client's transport is unavailable", async (t) => {
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

  // No context.client at all -- e.g. a future opencode version that changes
  // its internal shape, or a real `opencode serve`/`opencode web` process
  // where Server.url is always set and a plain network fetch is correct
  // anyway.
  const plugin = await WorktreePlugin({
    directory: "/tmp/example-project",
    $: () => {
      throw new Error("$ should not be invoked");
    },
    serverUrl: new URL("http://localhost:4096"),
    experimental_workspace: { register: () => {} },
  });

  await assert.rejects(
    plugin.tool.worktree_remove.execute({ branch: "feature/test" }, { sessionID: "ses_test" }),
  );

  assert.equal(capturedArgs.baseUrl, "http://localhost:4096/");
  assert.equal(capturedArgs.fetch, undefined);
});
