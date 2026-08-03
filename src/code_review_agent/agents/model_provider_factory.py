"""Factory selecting a Strands Model provider (OpenAI-compatible or native Ollama)."""

import logging
from enum import StrEnum

from strands.models import Model
from strands.models.ollama import OllamaModel
from strands.models.openai import OpenAIModel

logger = logging.getLogger(__name__)

_DEFAULT_OLLAMA_HOST = "http://localhost:11434"


class ProviderType(StrEnum):
    """LLM backend a reviewer/agent talks to."""

    OPENAI = "openai"
    OLLAMA = "ollama"


def create_model_provider(
    provider_type: ProviderType,
    model_id: str,
    *,
    llm_base_url: str | None = None,
    temperature: float,
    max_tokens: int | None = None,
    frequency_penalty: float | None = None,
) -> Model:
    """Build the Strands ``Model`` for ``provider_type``.

    Args:
        provider_type: Which backend to construct a model for.
        model_id: Model identifier passed straight through to the SDK.
        llm_base_url: OpenAI-compatible base URL (OpenAI branch) or bare
            Ollama server host (Ollama branch, e.g. ``http://host:11434`` --
            NOT the ``/v1`` OpenAI-compat suffix). Defaults to
            ``http://localhost:11434`` when unset and provider is Ollama.
        temperature: Sampling temperature. OpenAI: applied only when
            ``llm_base_url`` is set (preserves pre-existing behavior).
            Ollama: always applied.
        max_tokens: Optional generation cap, forwarded verbatim.
        frequency_penalty: OpenAI Chat Completions-specific repeat penalty.
            Has no ``OllamaConfig`` equivalent; ignored (with a warning log)
            when ``provider_type`` is ``OLLAMA``.

    Returns:
        Model: A configured ``OpenAIModel`` or ``OllamaModel``.

    Raises:
        ValueError: ``provider_type`` is not a recognized ``ProviderType``.
    """
    if provider_type == ProviderType.OPENAI:
        extra_params: dict[str, int | float] = {}
        if max_tokens is not None:
            extra_params["max_tokens"] = max_tokens
        if frequency_penalty is not None:
            extra_params["frequency_penalty"] = frequency_penalty

        if llm_base_url:
            return OpenAIModel(
                model_id=model_id,
                client_args={"base_url": llm_base_url},
                params={"temperature": temperature, **extra_params},
            )
        if extra_params:
            return OpenAIModel(model_id=model_id, params=extra_params)
        return OpenAIModel(model_id=model_id)

    if provider_type == ProviderType.OLLAMA:
        if frequency_penalty is not None:
            logger.warning(
                "frequency_penalty=%s ignored: OllamaConfig has no equivalent "
                "parameter (provider_type=ollama)",
                frequency_penalty,
            )
        host = llm_base_url or _DEFAULT_OLLAMA_HOST
        if host.rstrip("/").endswith("/v1"):
            host = host.rstrip("/")[: -len("/v1")]
        if max_tokens is not None:
            return OllamaModel(
                host, model_id=model_id, temperature=temperature, max_tokens=max_tokens
            )
        return OllamaModel(host, model_id=model_id, temperature=temperature)

    raise ValueError(f"Unsupported provider_type: {provider_type!r}")
