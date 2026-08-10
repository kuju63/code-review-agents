import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { SKILLS_DIR } from "../skills/agent-skills-factory.js";

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB, matching the SDK's own file-editor default.

export interface FileReadToolOptions {
  /** Directory reads are confined to. Defaults to the skills reference directory. */
  root?: string;
  /** Maximum file size, in bytes, that may be read. */
  maxBytes?: number;
}

/**
 * A minimal, read-only file tool confined to a single directory.
 *
 * No vended tool in `@strands-agents/sdk` offers a plain read-only read: the
 * closest, `fileEditor`, also supports create/str_replace/insert and requires
 * a `Sandbox`. Reviewers only need to read the skill reference files that
 * `AgentSkills` lists but does not itself read, so this tool is intentionally
 * narrower: confined to `root`, read-only, and errors are returned as a
 * string result rather than thrown (mirroring Python's `file_read` tool
 * convention) so a single bad path does not abort the reviewer's turn.
 */
export function createFileReadTool(options: FileReadToolOptions = {}) {
  const root = options.root ?? SKILLS_DIR;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return tool({
    name: "file_read",
    description:
      "Read a text file's contents from the reviewer's skill reference directory. " +
      "The path must be relative to that directory.",
    inputSchema: z.object({
      path: z.string().describe("Path to the file, relative to the skills directory."),
    }),
    callback: async ({ path }: { path: string }): Promise<string> => {
      const resolved = resolve(root, path);
      if (resolved !== root && !resolved.startsWith(root + sep)) {
        return `Error: path "${path}" resolves outside the allowed directory; access denied.`;
      }

      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(resolved);
      } catch {
        return `Error: file not found: ${path}`;
      }

      if (!fileStat.isFile()) {
        return `Error: not a file (directory or special file): ${path}`;
      }
      if (fileStat.size > maxBytes) {
        return `Error: file too large (${fileStat.size} bytes exceeds the ${maxBytes}-byte size limit): ${path}`;
      }

      try {
        return await readFile(resolved, "utf-8");
      } catch (error) {
        return `Error: failed to read file: ${path} (${String(error)})`;
      }
    },
  });
}
