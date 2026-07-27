// opencode plugin: manage per-branch git worktrees under .claude/worktrees/.
//
// Exposes worktree_create / worktree_remove chat tools. Both switch the
// *current* session's file-operation scope via experimental_workspace.warp,
// so working inside (or leaving) a worktree never requires starting a new
// opencode session.
import { tool } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import path from "node:path";

const slugify = (branch) => branch.replace(/[^a-zA-Z0-9_.-]/g, "-");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const existing = await $`git -C ${directory} rev-parse --verify --quiet ${config.branch}`
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
          if (created.error) {
            workspace = await findWorkspaceByBranch(v2, branch);
            if (!workspace) {
              throw new Error(created.error.data?.message ?? "failed to create worktree");
            }
          }
          const warped = await v2.experimental.workspace.warp({ id: workspace.id, sessionID: context.sessionID });
          if (warped.error) {
            throw new Error(warped.error.data?.message ?? "failed to switch session scope");
          }
          return `Created worktree '${branch}' at ${workspace.directory}. This session's file scope is now that worktree.`;
        },
      }),
      worktree_remove: tool({
        description:
          "Switch this session's file-operation scope back to the main project path, then remove the given git worktree.",
        args: {
          branch: tool.schema.string(),
        },
        async execute({ branch }, context) {
          const listed = await v2.experimental.workspace.list();
          if (listed.error) {
            throw new Error(listed.error.data?.message ?? "failed to list worktrees");
          }
          const workspace = listed.data.find((w) => w.type === "git-worktree" && w.branch === branch);
          if (!workspace) {
            throw new Error(`No git-worktree workspace found for branch '${branch}'`);
          }
          const warped = await v2.experimental.workspace.warp({ id: null, sessionID: context.sessionID });
          if (warped.error) {
            throw new Error(warped.error.data?.message ?? "failed to switch session scope back to main");
          }
          const removed = await v2.experimental.workspace.remove({ id: workspace.id });
          if (removed.error) {
            throw new Error(removed.error.data?.message ?? "failed to remove worktree");
          }
          return `Session file scope moved back to the main project. Worktree '${branch}' removed.`;
        },
      }),
    },
  };
};

export default WorktreePlugin;
