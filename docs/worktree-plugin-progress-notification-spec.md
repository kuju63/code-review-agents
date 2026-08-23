# Worktree Plugin Progress Notification Specification

## Background

`worktree_create` and `worktree_remove` can wait on OpenCode workspace APIs or Git operations without displaying which operation is still running. A pending tool therefore appears frozen even when work continues.

Related Issue: #182

## Requirements

- Display an informational OpenCode TUI toast immediately when each long-running phase starts.
- Cover workspace list, workspace create, workspace warp, workspace removal, and `git worktree add` phases.
- If a phase remains pending for five seconds, display its phase name and elapsed time.
- Repeat the waiting notification every fifteen seconds until the phase ends.
- Display a final success or error toast for each worktree tool invocation.
- A failed or stalled toast request must not fail or delay the underlying worktree operation.
- Limit each toast request to two seconds.
- Preserve existing workspace and Git operation behavior and timeout semantics.

Verification plan: [docs/plan/worktree-plugin-progress-notification-spec.md](plan/worktree-plugin-progress-notification-spec.md).
