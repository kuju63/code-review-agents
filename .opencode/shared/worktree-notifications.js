// Toast-notification helpers shared by .opencode/plugins/worktree.js.
//
// Deliberately kept outside .opencode/plugins/: OpenCode's plugin loader
// invokes every exported function of a file under .opencode/plugins/ as an
// independent candidate plugin factory (passing the standard plugin context
// object). These helpers aren't plugin factories -- they're exported only so
// worktree.test.mjs can unit-test them -- so living in plugins/ made OpenCode
// call them with the wrong shape (e.g. withProgressNotifications destructured
// `notify` out of a context object that has no such field) and log a spurious
// "failed to load plugin" error on every startup.
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createToastNotifier(v2, { timeoutMs = 2000 } = {}) {
  return (message, variant = "info") => {
    let request;
    try {
      request = v2.tui.showToast({
        title: "Git Worktree",
        message,
        variant,
        duration: 5000,
      });
    } catch {
      return;
    }
    void Promise.race([request, sleep(timeoutMs)]).catch(() => {});
  };
}

export async function withProgressNotifications({
  phase,
  operation,
  notify,
  initialDelayMs = 5000,
  intervalMs = 15000,
}) {
  const startedAt = Date.now();
  let interval;
  const reportWaiting = () => {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    notify(`${phase} is still running (${elapsedSeconds}s elapsed)`, "info");
  };
  notify(`${phase} started`, "info");
  const initialTimer = setTimeout(() => {
    reportWaiting();
    interval = setInterval(reportWaiting, intervalMs);
  }, initialDelayMs);
  try {
    return await operation();
  } finally {
    clearTimeout(initialTimer);
    if (interval) clearInterval(interval);
  }
}

export async function withToolStatus({ label, operation, notify }) {
  try {
    const result = await operation();
    notify(`${label} completed`, "success");
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    notify(`${label} failed: ${detail}`, "error");
    throw error;
  }
}
