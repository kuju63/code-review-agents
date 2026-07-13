"""Shared exception types for the review-stage and lead-engineer agents."""

from httpx import TransportError
from strands.types.exceptions import (
    EventLoopException,
    MCPClientInitializationError,
    ToolProviderException,
)

INFRA_EXCEPTIONS: tuple[type[BaseException], ...] = (
    EventLoopException,
    MCPClientInitializationError,
    ToolProviderException,
    TransportError,
)
"""Exceptions treated as infrastructure failures rather than isolated/business
errors (model connection loss, GitHub MCP client init failure, transport-level
timeouts). Callers should re-raise these instead of degrading them to a
business-level error/empty result, so the A2A task boundary handler
(``except Exception`` in ``api/agents/*.py``) marks the task as failed instead
of silently completing with partial data.
"""


class StructuredOutputMissingError(RuntimeError):
    """Raised when an LLM agent call ends without a structured output result.

    Strands does not raise when a turn/token limit is exhausted: it returns an
    ``AgentResult`` with ``stop_reason`` set (e.g. ``"limit_turns"``) and
    ``structured_output=None`` instead. Callers must check for this explicitly
    rather than assuming ``result.structured_output`` is always populated —
    otherwise the failure surfaces later as an opaque ``AttributeError`` on
    whatever field is accessed first.
    """

    def __init__(self, agent_label: str, stop_reason: str | None) -> None:
        super().__init__(
            f"{agent_label} completed without producing structured output "
            f"(stop_reason={stop_reason!r}). The model likely could not satisfy "
            "the output schema within the configured turn limit."
        )
