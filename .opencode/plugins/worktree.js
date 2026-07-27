// opencode plugin: manage per-branch git worktrees under .claude/worktrees/.
//
// Exposes worktree_create / worktree_remove chat tools. Both switch the
// *current* session's file-operation scope via experimental_workspace.warp,
// so working inside (or leaving) a worktree never requires starting a new
// opencode session.
import { tool } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import path from "node:path";

// Escapes every literal '-' to '--' first, then replaces each disallowed
// character with a '-<hex codepoint>-' escape. Because a raw '-' can only
// ever appear doubled, single-'-' escape delimiters never collide with an
// escaped literal dash, so distinct branch names always slugify to distinct
// paths (e.g. "feature/foo" and "feature-foo" no longer collapse to the same
// directory).
const slugify = (branch) =>
  branch.replace(/-/g, "--").replace(/[^a-zA-Z0-9_.-]/g, (ch) => `-${ch.codePointAt(0).toString(16)}-`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        await $`git -C ${directory} worktree add ${config.directory} ${config.branch}`.env(shellEnv);
      } else {
        const base = config.extra?.base || "main";
        await $`git -C ${directory} worktree add ${config.directory} -b ${config.branch} ${base}`.env(shellEnv);
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
          const created = await v2.experimental.workspace.create({
            type: "git-worktree",
            branch,
            extra: { base },
          });
          let workspace = created.data;
          let recovered = false;
          if (created.error) {
            const message = created.error.data?.message;
            if (!isWorkspaceReadyTimeout(message)) {
              throw new Error(message ?? "failed to create worktree");
            }
            workspace = await findWorkspaceByBranch(v2, branch);
            recovered = true;
            if (!workspace) {
              throw new Error(message ?? "failed to create worktree");
            }
          }
          unwrap(
            await v2.experimental.workspace.warp({ id: workspace.id, sessionID: context.sessionID }),
            "failed to switch session scope",
          );
          const status = recovered
            ? `Worktree '${branch}' is ready at ${workspace.directory} (confirmed via polling after the create request timed out)`
            : `Created worktree '${branch}' at ${workspace.directory}`;
          return `${status}. This session's file scope is now that worktree.`;
        },
      }),
      worktree_remove: tool({
        description:
          "Switch this session's file-operation scope back to the main project path, then remove the given git worktree.",
        args: {
          branch: tool.schema.string(),
        },
        async execute({ branch }, context) {
          const workspaces = unwrap(await v2.experimental.workspace.list(), "failed to list worktrees");
          const workspace = workspaces.find((w) => w.type === "git-worktree" && w.branch === branch);
          if (!workspace) {
            throw new Error(`No git-worktree workspace found for branch '${branch}'`);
          }
          unwrap(
            await v2.experimental.workspace.warp({ id: null, sessionID: context.sessionID }),
            "failed to switch session scope back to main",
          );
          const removed = await v2.experimental.workspace.remove({ id: workspace.id });
          if (removed.error) {
            // The session was already warped out of this workspace above so the
            // worktree directory could be deleted; if deletion itself failed, try
            // to restore the session's scope rather than leaving it silently
            // detached from a worktree that still exists on disk and in the
            // workspace registry.
            const restored = await v2.experimental.workspace.warp({ id: workspace.id, sessionID: context.sessionID });
            if (restored.error) {
              console.error(
                `[git-worktree] failed to restore session scope into '${branch}' after remove failure:`,
                restored.error.data?.message,
              );
            }
            throw new Error(removed.error.data?.message ?? "failed to remove worktree");
          }
          return `Session file scope moved back to the main project. Worktree '${branch}' removed.`;
        },
      }),
    },
  };
};

export default WorktreePlugin;
