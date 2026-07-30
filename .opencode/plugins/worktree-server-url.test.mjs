import assert from "node:assert/strict";
import test from "node:test";

// Requires `node --experimental-test-module-mocks` (mocks @opencode-ai/sdk/v2
// via t.mock.module below).
//
// Kept in its own file: see worktree-error-surfacing.test.mjs for why a
// module that dynamically imports worktree.js needs process isolation from
// other files mocking the same @opencode-ai/sdk/v2 module.

test("WorktreePlugin re-reads context.serverUrl on every client access instead of caching it at init time", async (t) => {
  const capturedBaseUrls = [];

  t.mock.module("@opencode-ai/sdk/v2", {
    exports: {
      createOpencodeClient: (args) => {
        capturedBaseUrls.push(args.baseUrl);
        return {
          tui: { showToast: async () => {} },
          experimental: { workspace: { list: async () => ({ data: [] }) } },
        };
      },
    },
  });

  const { WorktreePlugin } = await import("./worktree.js");

  // opencode's real plugin loader exposes context.serverUrl as a live getter
  // (`Server.url ?? new URL("http://localhost:4096")`) that can resolve to
  // the unreachable fallback if this plugin factory runs before the HTTP
  // server finishes starting, then resolve to the real listener URL once it
  // has. Model that here with a getter whose return value changes between
  // accesses, standing in for Server.url flipping from unset to set.
  let serverUrl = new URL("http://localhost:4096");
  const context = {
    directory: "/tmp/example-project",
    $: () => {
      throw new Error("$ should not be invoked");
    },
    get serverUrl() {
      return serverUrl;
    },
    experimental_workspace: { register: () => {} },
  };

  const plugin = await WorktreePlugin(context);

  await assert.rejects(
    plugin.tool.worktree_remove.execute({ branch: "feature/test" }, { sessionID: "ses_test" }),
  );
  // A single tool call touches v2 more than once (e.g. workspace.list() plus
  // notify()'s toast calls), so capture everything seen during this call
  // rather than asserting on a single value.
  const firstCallBaseUrls = capturedBaseUrls.splice(0, capturedBaseUrls.length);

  serverUrl = new URL("http://127.0.0.1:52041");

  await assert.rejects(
    plugin.tool.worktree_remove.execute({ branch: "feature/test-2" }, { sessionID: "ses_test" }),
  );
  const secondCallBaseUrls = capturedBaseUrls.splice(0, capturedBaseUrls.length);

  assert.ok(firstCallBaseUrls.length > 0);
  assert.ok(firstCallBaseUrls.every((url) => url === "http://localhost:4096/"));
  assert.ok(secondCallBaseUrls.length > 0);
  assert.ok(secondCallBaseUrls.every((url) => url === "http://127.0.0.1:52041/"));
});
