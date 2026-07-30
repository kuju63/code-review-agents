import assert from "node:assert/strict";
import test from "node:test";

// Requires `node --experimental-test-module-mocks` (mocks @opencode-ai/sdk/v2
// via t.mock.module below).
//
// Kept in its own file, separate from worktree.test.mjs: `node --test` runs
// each test file in its own process, so this file's `@opencode-ai/sdk/v2`
// mock (which needs an `experimental.workspace` shape) can't collide with
// worktree.test.mjs's own mock of the same module -- ESM caches a dynamic
// `import("./worktree.js")` after its first evaluation, so a second mock
// registered later in the same process wouldn't actually take effect.

test("worktree tools surface the SDK's plain Error message when a typed error carries no data", async (t) => {
  // The SDK's error interceptor wraps non-JSON/empty response bodies in a
  // plain Error with only `.message` (no `.data`) -- e.g. a 404 with no body.
  // worktree.js must fall back to that `.message` instead of losing the
  // actual HTTP status/URL behind a generic fallback string.
  t.mock.module("@opencode-ai/sdk/v2", {
    exports: {
      createOpencodeClient: () => ({
        tui: { showToast: async () => {} },
        experimental: {
          workspace: {
            list: async () => ({
              error: new Error(
                "opencode server GET http://localhost:4096/experimental/workspace → 404 Not Found: (empty response body)",
              ),
            }),
            create: async () => ({
              error: new Error(
                "opencode server POST http://localhost:4096/experimental/workspace → 404 Not Found: (empty response body)",
              ),
            }),
          },
        },
      }),
    },
  });

  const { WorktreePlugin } = await import("./worktree.js");

  const plugin = await WorktreePlugin({
    directory: "/tmp/example-project",
    $: () => {
      throw new Error("$ should not be invoked");
    },
    serverUrl: new URL("http://localhost:4096"),
    experimental_workspace: { register: () => {} },
  });

  await assert.rejects(
    plugin.tool.worktree_create.execute({ branch: "feature/test" }, { sessionID: "ses_test" }),
    (error) => {
      assert.match(error.message, /POST .* → 404 Not Found/);
      return true;
    },
  );

  await assert.rejects(
    plugin.tool.worktree_remove.execute({ branch: "feature/test" }, { sessionID: "ses_test" }),
    (error) => {
      assert.match(error.message, /GET .* → 404 Not Found/);
      return true;
    },
  );
});
