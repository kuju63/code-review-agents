"""Tests for the Ollama-unsupported tool result content sanitizer."""

import logging
from unittest.mock import MagicMock

from strands.hooks import AfterToolCallEvent, HookRegistry
from strands.types.tools import ToolResultContent

from code_review_agent.tools.tool_result_sanitizer import (
    OllamaUnsupportedContentSanitizer,
)


def _make_event(
    content: list[ToolResultContent], tool_name: str = "file_read"
) -> AfterToolCallEvent:
    """Build an ``AfterToolCallEvent`` carrying ``content`` as the tool result.

    Returns:
        The event, ready to pass to the sanitizer's callback.
    """
    return AfterToolCallEvent(
        agent=MagicMock(),
        selected_tool=None,
        tool_use={"toolUseId": "t1", "name": tool_name, "input": {}},
        invocation_state={},
        result={"toolUseId": "t1", "status": "success", "content": content},
    )


class TestOllamaUnsupportedContentSanitizer:
    def test_replaces_document_block_with_text_placeholder(self):
        event = _make_event(
            [{"document": {"format": "md", "name": "x", "source": {"bytes": b""}}}]
        )

        OllamaUnsupportedContentSanitizer()._sanitize(event)

        assert event.result["content"] == [
            {"text": "[omitted: unsupported content type ['document']]"}
        ]

    def test_leaves_supported_content_unchanged(self):
        original = [{"text": "hello"}, {"json": {"a": 1}}]
        event = _make_event(list(original))

        OllamaUnsupportedContentSanitizer()._sanitize(event)

        assert event.result["content"] == original

    def test_replaces_only_the_document_block_among_several(self):
        event = _make_event(
            [
                {"text": "before"},
                {"document": {"format": "md", "name": "x", "source": {"bytes": b""}}},
                {"text": "after"},
            ]
        )

        OllamaUnsupportedContentSanitizer()._sanitize(event)

        assert event.result["content"] == [
            {"text": "before"},
            {"text": "[omitted: unsupported content type ['document']]"},
            {"text": "after"},
        ]

    def test_no_content_is_a_no_op(self):
        event = _make_event([])

        OllamaUnsupportedContentSanitizer()._sanitize(event)

        assert event.result["content"] == []

    def test_logs_warning_naming_tool_and_stripped_keys(self, caplog):
        event = _make_event(
            [{"document": {"format": "md", "name": "x", "source": {"bytes": b""}}}],
            tool_name="file_read",
        )

        with caplog.at_level(logging.WARNING):
            OllamaUnsupportedContentSanitizer()._sanitize(event)

        assert "file_read" in caplog.text
        assert "document" in caplog.text

    def test_register_hooks_subscribes_to_after_tool_call_event(self):
        sanitizer = OllamaUnsupportedContentSanitizer()
        registry = HookRegistry()

        registry.add_hook(sanitizer)

        event = _make_event(
            [{"document": {"format": "md", "name": "x", "source": {"bytes": b""}}}]
        )
        registry.invoke_callbacks(event)

        assert event.result["content"] == [
            {"text": "[omitted: unsupported content type ['document']]"}
        ]
