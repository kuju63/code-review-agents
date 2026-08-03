"""Runtime configuration for the FastAPI service, sourced from the environment."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from ..agents.model_provider_factory import ProviderType


class Settings(BaseSettings):
    """Environment-backed runtime configuration for the API and its agents.

    Values are read from ``CODE_REVIEW_``-prefixed environment variables (or
    a ``.env`` file); unrecognized variables are ignored rather than raising.

    ``max_tokens``/``frequency_penalty`` bound and discourage runaway
    single-turn generation from local models; ``None`` (default) preserves
    the current unbounded behavior. ``frequency_penalty`` follows the OpenAI
    Chat Completions range of -2.0 to 2.0.

    ``provider_type`` selects the backend every agent's model is built
    against (see
    :func:`~code_review_agent.agents.model_provider_factory.create_model_provider`).
    It is a deployment-level choice with no per-request override, unlike
    ``model_id``.
    """

    model_config = SettingsConfigDict(
        env_prefix="CODE_REVIEW_", env_file=".env", extra="ignore"
    )

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"

    model_id: str = "gpt-4o"
    llm_base_url: str | None = None
    provider_type: ProviderType = ProviderType.OPENAI
    max_agent_turns: int = 30
    max_tokens: int | None = None
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    reviewer_timeout_seconds: float | None = None
    patch_total_char_limit: int = 30_000
    patch_max_files: int = 30
    mcp_startup_retry_attempts: int = 3
    mcp_startup_retry_backoff_seconds: float = 1.0

    agent_base_url: str = "http://localhost:8000"
    agent_pr_info_collector_url: str | None = None
    agent_react_reviewer_url: str | None = None
    agent_vue_reviewer_url: str | None = None
    agent_angular_reviewer_url: str | None = None
    agent_svelte_reviewer_url: str | None = None
    agent_security_reviewer_url: str | None = None
    agent_lead_engineer_url: str | None = None
    agent_orchestrator_url: str | None = None

    def resolve_agent_url(self, prefix: str, override: str | None) -> str:
        """Resolve the public URL an agent card should advertise for itself.

        Args:
            prefix: Path segment the agent is mounted under (for example
                ``"react-reviewer"``), used when no override is set.
            override: Explicit URL configured for this agent, if any.

        Returns:
            ``override`` when set, otherwise ``agent_base_url`` joined with
            ``prefix``.
        """
        base = self.agent_base_url.rstrip("/")
        return override or f"{base}/{prefix.lstrip('/')}"
