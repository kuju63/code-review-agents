// opencode plugin: manage per-branch git worktrees under .claude/worktrees/.
//
// Exposes worktree_create / worktree_remove chat tools. Both switch the
// *current* session's file-operation scope via experimental_workspace.warp,
// so working inside (or leaving) a worktree never requires starting a new
// opencode session.
import { tool } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import path from "node:path";
import { createToastNotifier, sleep, withProgressNotifications, withToolStatus } from "../shared/worktree-notifications.js";

// Escapes every literal '-' to '--' first, then replaces each disallowed
// character with a '-<hex codepoint>-' escape. Because a raw '-' can only
// ever appear doubled, single-'-' escape delimiters never collide with an
// escaped literal dash, so distinct branch names always slugify to distinct
// paths (e.g. "feature/foo" and "feature-foo" no longer collapse to the same
// directory).
const slugify = (branch) =>
  branch.replace(/-/g, "--").replace(/[^a-zA-Z0-9_.-]/g, (ch) => `-${ch.codePointAt(0).toString(16)}-`);

// Switches the session's file-operation scope to the given workspace id
// (null = main project) and unwraps the response.
async function switchToWorkspace({ v2, workspaceID, sessionID, notify }) {
  return unwrap(
    await withProgressNotifications({
      phase: `Switching session to '${workspaceID ?? "main"}'`,
      operation: () =>
        v2.experimental.workspace.warp({
          id: workspaceID,
          sessionID,
        }),
      notify,
    }),
    "failed to switch session scope",
  );
}

// Matches the "workspace ready" wait timeout described below. WorkspaceCreateError
// carries no machine-readable error code, only this message, so detection is
// necessarily string-based.
const isWorkspaceReadyTimeout = (message) => /timed out waiting for/i.test(message ?? "");

// Throws with the SDK's error message (falling back to a generic one) when a
// v2 experimental_workspace call reports an error; otherwise returns its data.
// Centralizes the `result.error ? throw ... : result.data` shape repeated
// across both tools below.
function unwrap(result, fallback) {
  if (result.error) {
    throw new Error(result.error.data?.message ?? fallback);
  }
  return result.data;
}

// opencode's workspace.create() waits on an internal "workspace ready" event
// with a short (~5s) budget and reports a timeout error even when the
// underlying git worktree creation succeeds moments later in the background
// (observed for both the built-in "worktree" adapter and this custom one, so
// it isn't specific to this plugin). Poll workspace.list() briefly instead of
// treating that timeout as fatal.
async function findWorkspaceByBranch(v2, branch, { attempts = 20, intervalMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const listed = await v2.experimental.workspace.list();
    if (!listed.error) {
      const workspace = listed.data.find((w) => w.type === "git-worktree" && w.branch === branch);
      if (workspace) return workspace;
    }
    await sleep(intervalMs);
  }
  return undefined;
}

export const WorktreePlugin = async ({ directory, $, serverUrl, experimental_workspace }) => {
  const v2 = createOpencodeClient({ baseUrl: serverUrl.toString() });
  const notify = createToastNotifier(v2);

  experimental_workspace.register("git-worktree", {
    name: "Git Worktree",
    description: "Create/remove a git worktree under .claude/worktrees for this project",
    configure(config) {
      const slug = slugify(config.branch);
      return {
        ...config,
        directory: path.join(directory, ".claude", "worktrees", slug),
      };
    },
    async create(config, env) {
      const shellEnv = { ...process.env, ...env };
      // show-ref (not rev-parse --verify, which also resolves tags/remote refs/raw
      // SHAs) so a branch name colliding with a tag or commit-ish still gets a real
      // local branch via `-b` below instead of a silent detached-HEAD checkout.
      const existing = await $`git -C ${directory} show-ref --verify --quiet refs/heads/${config.branch}`
        .nothrow()
        .quiet();
      if (existing.exitCode === 0) {
        await withProgressNotifications({
          phase: `Adding Git worktree for '${config.branch}'`,
          operation: () =>
            $`git -C ${directory} worktree add ${config.directory} ${config.branch}`.env(shellEnv),
          notify,
        });
      } else {
        const base = config.extra?.base || "main";
        await withProgressNotifications({
          phase: `Adding Git worktree for '${config.branch}' from '${base}'`,
          operation: () =>
            $`git -C ${directory} worktree add ${config.directory} -b ${config.branch} ${base}`.env(shellEnv),
          notify,
        });
      }
      // Deliberately not awaited: opencode waits on a "workspace ready" event
      // with a short timeout, and scripts/setup-worktree.sh's venv/uv sync can
      // run well past that. The worktree itself (from `git worktree add` above)
      // is already usable; setup finishes in the background.
      $`bash scripts/setup-worktree.sh`
        .cwd(config.directory)
        .env(shellEnv)
        .catch((err) => console.error(`[git-worktree] setup-worktree.sh failed for ${config.directory}:`, err));
    },
    async remove(config) {
      await $`bash scripts/remove-worktree.sh --force ${config.directory}`.cwd(directory);
    },
    target(config) {
      return { type: "local", directory: config.directory };
    },
  });

  return {
    tool: {
      worktree_create: tool({
        description:
          "Create a git worktree for the given branch and switch this session's file-operation scope into it, without starting a new session.",
        args: {
          branch: tool.schema.string(),
          base: tool.schema.string().optional(),
        },
        async execute({ branch, base }, context) {
          return withToolStatus({
            label: `Create worktree '${branch}'`,
            notify,
            operation: async () => {
              // Check before create() so a workspace that already existed for this
              // branch (created earlier, or by a concurrent request) isn't reported
              // as "recovered from a timeout" below -- that label is reserved for
              // workspaces this specific create() call actually produced.
              const preexisting = await withProgressNotifications({
                phase: `Checking existing workspaces for '${branch}'`,
                operation: () => findWorkspaceByBranch(v2, branch, { attempts: 1, intervalMs: 0 }),
                notify,
              });
              if (preexisting) {
                await switchToWorkspace({ v2, workspaceID: preexisting.id, sessionID: context.sessionID, notify });
                return `Worktree '${branch}' already exists at ${preexisting.directory}. This session's file scope is now that worktree.`;
              }

              const created = await withProgressNotifications({
                phase: `Creating workspace for '${branch}'`,
                operation: () =>
                  v2.experimental.workspace.create({
                    type: "git-worktree",
                    branch,
                    extra: { base },
                  }),
                notify,
              });
              let workspace = created.data;
              let recovered = false;
              if (created.error) {
                const message = created.error.data?.message;
                if (!isWorkspaceReadyTimeout(message)) {
                  throw new Error(message ?? "failed to create worktree");
                }
                workspace = await withProgressNotifications({
                  phase: `Waiting for workspace '${branch}' to become ready`,
                  operation: () => findWorkspaceByBranch(v2, branch),
                  notify,
                });
                recovered = true;
                if (!workspace) {
                  throw new Error(message ?? "failed to create worktree");
                }
              }
              await switchToWorkspace({ v2, workspaceID: workspace.id, sessionID: context.sessionID, notify });
              const status = recovered
                ? `Worktree '${branch}' is ready at ${workspace.directory} (confirmed via polling after the create request timed out)`
                : `Created worktree '${branch}' at ${workspace.directory}`;
              return `${status}. This session's file scope is now that worktree.`;
            },
          });
        },
      }),
      worktree_remove: tool({
        description:
          "Switch this session's file-operation scope back to the main project path, then remove the given git worktree.",
        args: {
          branch: tool.schema.string(),
        },
        async execute({ branch }, context) {
          return withToolStatus({
            label: `Remove worktree '${branch}'`,
            notify,
            operation: async () => {
              const workspaces = unwrap(
                await withProgressNotifications({
                  phase: `Finding workspace for '${branch}'`,
                  operation: () => v2.experimental.workspace.list(),
                  notify,
                }),
                "failed to list worktrees",
              );
              const workspace = workspaces.find(
                (w) => w.type === "git-worktree" && w.branch === branch,
              );
              if (!workspace) {
                throw new Error(`No git-worktree workspace found for branch '${branch}'`);
              }
              // The session invoking this tool isn't necessarily scoped into the
              // worktree being removed (it could already be on main, or on a
              // different worktree entirely). Capture wherever it actually is
              // before warping to main, so a failed remove() below restores that
              // -- not the (possibly now-gone) workspace we tried to remove.
              const sessionBefore = await withProgressNotifications({
                phase: "Reading current session workspace",
                operation: () => v2.session.get({ sessionID: context.sessionID }),
                notify,
              });
              const previousWorkspaceID = sessionBefore.error
                ? null
                : (sessionBefore.data.workspaceID ?? null);

              unwrap(
                await withProgressNotifications({
                  phase: "Switching session back to main",
                  operation: () =>
                    v2.experimental.workspace.warp({
                      id: null,
                      sessionID: context.sessionID,
                    }),
                  notify,
                }),
                "failed to switch session scope back to main",
              );
              const removed = await withProgressNotifications({
                phase: `Removing workspace '${branch}'`,
                operation: () => v2.experimental.workspace.remove({ id: workspace.id }),
                notify,
              });
              if (removed.error) {
                // The session was already warped out of its prior scope above so
                // the worktree directory could be deleted; if deletion itself
                // failed, try to restore the session's scope rather than leaving
                // it silently detached from where it actually was.
                const restored = await withProgressNotifications({
                  phase: "Restoring previous session workspace",
                  operation: () =>
                    v2.experimental.workspace.warp({
                      id: previousWorkspaceID,
                      sessionID: context.sessionID,
                    }),
                  notify,
                });
                if (restored.error) {
                  console.error(
                    `[git-worktree] failed to restore session scope (was ${previousWorkspaceID ?? "main"}) after removing '${branch}' failed:`,
                    restored.error.data?.message,
                  );
                }
                throw new Error(removed.error.data?.message ?? "failed to remove worktree");
              }
              return `Session file scope moved back to the main project. Worktree '${branch}' removed.`;
            },
          });
        },
      }),
    },
  };
};

export default WorktreePlugin;
