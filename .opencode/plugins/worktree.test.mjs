import assert from "node:assert/strict";
import test from "node:test";

import {
  createToastNotifier,
  withProgressNotifications,
  withToolStatus,
} from "../shared/worktree-notifications.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("withProgressNotifications reports the phase immediately and while waiting", async () => {
  const messages = [];

  const result = await withProgressNotifications({
    phase: "Creating workspace",
    operation: async () => {
      await wait(35);
      return "created";
    },
    notify: (message) => messages.push(message),
    initialDelayMs: 5,
    intervalMs: 10,
  });

  assert.equal(result, "created");
  assert.equal(messages[0], "Creating workspace started");
  assert.ok(messages.some((message) => message.includes("Creating workspace is still running")));
  assert.ok(messages.length >= 3);
});

test("withProgressNotifications stops reporting after the operation finishes", async () => {
  const messages = [];

  await withProgressNotifications({
    phase: "Listing workspaces",
    operation: async () => "listed",
    notify: (message) => messages.push(message),
    initialDelayMs: 5,
    intervalMs: 5,
  });
  await wait(20);

  assert.deepEqual(messages, ["Listing workspaces started"]);
});

test("createToastNotifier does not wait for an unresolved toast request", async () => {
  let called = false;
  const v2 = {
    tui: {
      showToast: async () => {
        called = true;
        return new Promise(() => {});
      },
    },
  };
  const notify = createToastNotifier(v2, { timeoutMs: 5 });

  const startedAt = Date.now();
  notify("Waiting", "info");
  const elapsedMs = Date.now() - startedAt;

  assert.equal(called, true);
  assert.ok(elapsedMs < 5);
  await wait(10);
});

test("withToolStatus reports success without changing the result", async () => {
  const notifications = [];

  const result = await withToolStatus({
    label: "Create worktree 'feature/test'",
    operation: async () => "done",
    notify: (message, variant) => notifications.push({ message, variant }),
  });

  assert.equal(result, "done");
  assert.deepEqual(notifications, [
    { message: "Create worktree 'feature/test' completed", variant: "success" },
  ]);
});

test("withToolStatus reports failure and preserves the original error", async () => {
  const notifications = [];
  const error = new Error("workspace API failed");

  await assert.rejects(
    withToolStatus({
      label: "Create worktree 'feature/test'",
      operation: async () => {
        throw error;
      },
      notify: (message, variant) => notifications.push({ message, variant }),
    }),
    (received) => received === error,
  );
  assert.deepEqual(notifications, [
    {
      message: "Create worktree 'feature/test' failed: workspace API failed",
      variant: "error",
    },
  ]);
});
