"""Sanitizes tool results the active model backend cannot serialize.

``strands_tools.file_read``'s model-chosen ``mode="document"`` and any
future MCP tool can return a ``document``-shaped :class:`ToolResultContent`
block. ``OllamaModel`` cannot serialize that block and raises ``TypeError``
when it reaches the model formatter. See
``docs/ollama-tool-result-content-sanitizer-spec.md`` for the investigation
and design rationale.
"""

import logging

from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.types.tools import ToolResultContent

logger = logging.getLogger(__name__)

# Content keys confirmed (by reading strands.models.ollama source) to make
# OllamaModel raise TypeError. Not a general "unsupported by Ollama"
# whitelist -- if a new key turns up unsupported, verify it against the
# current strands source before adding it here rather than guessing ahead.
_OLLAMA_UNSUPPORTED_CONTENT_KEYS = frozenset({"document"})


class OllamaUnsupportedContentSanitizer(HookProvider):
    """Strips ``ToolResultContent`` blocks the active Ollama backend cannot serialize.

    Hooks ``AfterToolCallEvent``, which fires for every tool call regardless
    of which tool produced the result, so no per-tool special-casing is
    needed when new MCP integrations are added later.
    """

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        """Subscribe to ``AfterToolCallEvent`` on ``registry``."""
        registry.add_callback(AfterToolCallEvent, self._sanitize)

    def _sanitize(self, event: AfterToolCallEvent) -> None:
        content = event.result.get("content")
        if not content:
            return

        sanitized: list[ToolResultContent] = []
        changed = False
        for block in content:
            unsupported = _OLLAMA_UNSUPPORTED_CONTENT_KEYS.intersection(block)
            if unsupported:
                changed = True
                logger.warning(
                    "Stripping unsupported content type(s) %s from tool "
                    "'%s' result (Ollama backend cannot serialize them)",
                    sorted(unsupported),
                    event.tool_use.get("name"),
                )
                sanitized.append(
                    {
                        "text": f"[omitted: unsupported content type {sorted(unsupported)}]"
                    }
                )
            else:
                sanitized.append(block)

        if changed:
            event.result["content"] = sanitized
