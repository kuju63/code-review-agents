"""Tests for model_provider_factory."""

from enum import StrEnum
from unittest.mock import patch

import pytest

from code_review_agent.agents.model_provider_factory import (
    ProviderType,
    create_model_provider,
)

_MOD = "code_review_agent.agents.model_provider_factory"


class TestProviderType:
    def test_openai_value(self):
        assert ProviderType.OPENAI == "openai"

    def test_ollama_value(self):
        assert ProviderType.OLLAMA == "ollama"

    def test_is_str_enum(self):
        assert issubclass(ProviderType, StrEnum)
        assert isinstance(ProviderType.OPENAI, str)


class TestCreateModelProviderOpenAI:
    def test_no_base_url_no_extras(self):
        with patch(f"{_MOD}.OpenAIModel") as mock_model_cls:
            create_model_provider(ProviderType.OPENAI, "gpt-4o", temperature=0.1)

        mock_model_cls.assert_called_once_with(model_id="gpt-4o")

    def test_base_url_set(self):
        with patch(f"{_MOD}.OpenAIModel") as mock_model_cls:
            create_model_provider(
                ProviderType.OPENAI,
                "gpt-4o",
                llm_base_url="http://localhost:11434/v1",
                temperature=0.1,
            )

        mock_model_cls.assert_called_once_with(
            model_id="gpt-4o",
            client_args={"base_url": "http://localhost:11434/v1"},
            params={"temperature": 0.1},
        )

    def test_no_base_url_with_extras(self):
        with patch(f"{_MOD}.OpenAIModel") as mock_model_cls:
            create_model_provider(
                ProviderType.OPENAI,
                "gpt-4o",
                temperature=0.1,
                max_tokens=4096,
                frequency_penalty=0.4,
            )

        mock_model_cls.assert_called_once_with(
            model_id="gpt-4o",
            params={"max_tokens": 4096, "frequency_penalty": 0.4},
        )

    def test_base_url_with_extras(self):
        with patch(f"{_MOD}.OpenAIModel") as mock_model_cls:
            create_model_provider(
                ProviderType.OPENAI,
                "gpt-4o",
                llm_base_url="http://localhost:11434/v1",
                temperature=0.3,
                max_tokens=4096,
                frequency_penalty=0.4,
            )

        mock_model_cls.assert_called_once_with(
            model_id="gpt-4o",
            client_args={"base_url": "http://localhost:11434/v1"},
            params={"temperature": 0.3, "max_tokens": 4096, "frequency_penalty": 0.4},
        )


class TestCreateModelProviderOllama:
    def test_base_url_set(self):
        with patch(f"{_MOD}.OllamaModel") as mock_model_cls:
            create_model_provider(
                ProviderType.OLLAMA,
                "ornith:latest",
                llm_base_url="http://localhost:11434",
                temperature=0.1,
            )

        mock_model_cls.assert_called_once_with(
            "http://localhost:11434", model_id="ornith:latest", temperature=0.1
        )

    def test_base_url_unset_uses_default_host(self):
        with patch(f"{_MOD}.OllamaModel") as mock_model_cls:
            create_model_provider(ProviderType.OLLAMA, "ornith:latest", temperature=0.1)

        mock_model_cls.assert_called_once_with(
            "http://localhost:11434", model_id="ornith:latest", temperature=0.1
        )

    def test_v1_suffix_is_stripped(self):
        with patch(f"{_MOD}.OllamaModel") as mock_model_cls:
            create_model_provider(
                ProviderType.OLLAMA,
                "ornith:latest",
                llm_base_url="http://localhost:11434/v1",
                temperature=0.1,
            )

        mock_model_cls.assert_called_once_with(
            "http://localhost:11434", model_id="ornith:latest", temperature=0.1
        )

    def test_max_tokens_forwarded_as_top_level_kwarg(self):
        with patch(f"{_MOD}.OllamaModel") as mock_model_cls:
            create_model_provider(
                ProviderType.OLLAMA,
                "ornith:latest",
                llm_base_url="http://localhost:11434",
                temperature=0.1,
                max_tokens=4096,
            )

        mock_model_cls.assert_called_once_with(
            "http://localhost:11434",
            model_id="ornith:latest",
            temperature=0.1,
            max_tokens=4096,
        )

    def test_frequency_penalty_is_ignored_with_warning(self, caplog):
        with (
            patch(f"{_MOD}.OllamaModel") as mock_model_cls,
            caplog.at_level("WARNING"),
        ):
            create_model_provider(
                ProviderType.OLLAMA,
                "ornith:latest",
                llm_base_url="http://localhost:11434",
                temperature=0.1,
                frequency_penalty=0.4,
            )

        mock_model_cls.assert_called_once_with(
            "http://localhost:11434", model_id="ornith:latest", temperature=0.1
        )
        assert "frequency_penalty" in caplog.text


class TestCreateModelProviderUnknown:
    def test_unknown_provider_type_raises(self):
        with pytest.raises(ValueError, match="Unsupported provider_type"):
            create_model_provider(
                "bogus",  # type: ignore[arg-type]
                "gpt-4o",
                temperature=0.1,
            )
