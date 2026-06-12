import pytest
from pydantic_settings import PydanticBaseSettingsSource, SettingsConfigDict

from code_review_agent.api.config import Settings


class _IsolatedSettings(Settings):
    """Settings subclass for unit tests — skips .env file loading."""

    model_config = SettingsConfigDict(env_prefix="CODE_REVIEW_", extra="ignore")

    @classmethod
    def settings_customise_sources(  # type: ignore[override]
        cls,
        settings_cls: type[Settings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        **_kwargs: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (init_settings, env_settings)


_ENV_KEYS = [
    "CODE_REVIEW_HOST",
    "CODE_REVIEW_PORT",
    "CODE_REVIEW_LOG_LEVEL",
    "CODE_REVIEW_MODEL_ID",
    "CODE_REVIEW_LLM_BASE_URL",
    "CODE_REVIEW_AGENT_BASE_URL",
    "CODE_REVIEW_AGENT_PR_INFO_COLLECTOR_URL",
    "CODE_REVIEW_AGENT_REACT_REVIEWER_URL",
    "CODE_REVIEW_AGENT_SECURITY_REVIEWER_URL",
    "CODE_REVIEW_AGENT_LEAD_ENGINEER_URL",
    "CODE_REVIEW_AGENT_ORCHESTRATOR_URL",
]


@pytest.fixture()
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


class TestSettingsDefaults:
    def test_host_default(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.host == "0.0.0.0"

    def test_port_default(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.port == 8000

    def test_log_level_default(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.log_level == "info"

    def test_model_id_default(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.model_id == "gpt-4o"

    def test_llm_base_url_default_is_none(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.llm_base_url is None

    def test_agent_base_url_default(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.agent_base_url == "http://localhost:8000"

    def test_agent_url_overrides_default_to_none(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        assert s.agent_pr_info_collector_url is None
        assert s.agent_react_reviewer_url is None
        assert s.agent_security_reviewer_url is None
        assert s.agent_lead_engineer_url is None
        assert s.agent_orchestrator_url is None


class TestSettingsFromEnv:
    def test_reads_host_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CODE_REVIEW_HOST", "127.0.0.1")
        s = _IsolatedSettings()
        assert s.host == "127.0.0.1"

    def test_reads_port_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CODE_REVIEW_PORT", "9000")
        s = _IsolatedSettings()
        assert s.port == 9000

    def test_reads_model_id_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CODE_REVIEW_MODEL_ID", "gpt-4o-mini")
        s = _IsolatedSettings()
        assert s.model_id == "gpt-4o-mini"

    def test_reads_llm_base_url_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CODE_REVIEW_LLM_BASE_URL", "http://localhost:11434/v1")
        s = _IsolatedSettings()
        assert s.llm_base_url == "http://localhost:11434/v1"


class TestResolveAgentUrl:
    def test_returns_override_when_set(self) -> None:
        s = _IsolatedSettings()
        url = s.resolve_agent_url("pr-info-collector", "https://example.com/pr")
        assert url == "https://example.com/pr"

    def test_falls_back_to_base_url_when_override_is_none(
        self, clean_env: None
    ) -> None:
        s = _IsolatedSettings()
        url = s.resolve_agent_url("pr-info-collector", None)
        assert url == "http://localhost:8000/pr-info-collector"

    def test_normalizes_trailing_slash_in_base_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CODE_REVIEW_AGENT_BASE_URL", "http://localhost:8000/")
        s = _IsolatedSettings()
        url = s.resolve_agent_url("orchestrator", None)
        assert url == "http://localhost:8000/orchestrator"

    def test_normalizes_leading_slash_in_prefix(self, clean_env: None) -> None:
        s = _IsolatedSettings()
        url = s.resolve_agent_url("/react-reviewer", None)
        assert url == "http://localhost:8000/react-reviewer"
