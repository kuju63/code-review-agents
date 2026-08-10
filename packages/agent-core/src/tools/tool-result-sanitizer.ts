import {
  AfterToolCallEvent,
  DocumentBlock,
  type LocalAgent,
  type Plugin,
  TextBlock,
  ToolResultBlock,
  type ToolResultContent,
} from "@strands-agents/sdk";

/**
 * Content block classes confirmed (by reading the OllamaModel adapter's
 * source) to make it unable to serialize a tool result. Not a general
 * "unsupported by Ollama" whitelist -- if a new type turns up unsupported,
 * verify it against the current SDK source before adding it here rather
 * than guessing ahead. Mirrors Python's `_OLLAMA_UNSUPPORTED_CONTENT_KEYS`.
 */
const UNSUPPORTED_CONTENT_CLASSES = [DocumentBlock];

function isUnsupported(block: ToolResultContent): boolean {
  return UNSUPPORTED_CONTENT_CLASSES.some((cls) => block instanceof cls);
}

/**
 * Strips `ToolResultContent` blocks the active Ollama backend cannot
 * serialize (e.g. `file_read`'s model-chosen `document`-shaped result).
 *
 * Hooks `AfterToolCallEvent`, which fires for every tool call regardless of
 * which tool produced the result, so no per-tool special-casing is needed
 * when new MCP integrations are added later. `AgentConfig` has no `hooks`
 * field (unlike the Python SDK's `Agent(hooks=[...])`), so this is a Plugin
 * that registers itself via `initAgent` instead -- see
 * typescript-agents-tools-migration-spec.md section 2.4.
 */
export class OllamaUnsupportedContentSanitizer implements Plugin {
  readonly name = "ollama-unsupported-content-sanitizer";

  initAgent(agent: LocalAgent): void {
    agent.addHook(AfterToolCallEvent, (event) => this.sanitize(event));
  }

  private sanitize(event: AfterToolCallEvent): void {
    const content = event.result.content;
    if (content.length === 0) {
      return;
    }

    let changed = false;
    const sanitized = content.map((block) => {
      if (!isUnsupported(block)) {
        return block;
      }
      changed = true;
      console.warn(
        `Stripping unsupported content type '${block.type}' from tool ` +
          `'${event.toolUse.name}' result (Ollama backend cannot serialize it)`,
      );
      return new TextBlock(`[omitted: unsupported content type "${block.type}"]`);
    });

    if (changed) {
      event.result = new ToolResultBlock({
        toolUseId: event.result.toolUseId,
        status: event.result.status,
        content: sanitized,
        ...(event.result.error ? { error: event.result.error } : {}),
      });
    }
  }
}
