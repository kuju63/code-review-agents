"""Shared exception types for the review-stage and lead-engineer agents."""


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
